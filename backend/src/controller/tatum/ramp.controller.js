import crypto from "crypto";
import axios from "axios";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { generateTransakAccessToken } from "./transak.controller.js";
import { Transaction } from "../../model/transaction.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  normalizeSunAmount,
  sunToTrx,
  trxToSun,
} from "../../util/trxAmount.util.js";
import { assertValidTronAddress } from "../../util/tronAddress.util.js";
import {
  ensureWalletAccountingFields,
  getWalletBalanceSun,
} from "../../service/payment/walletAccounting.service.js";
import {
  reserveWithdrawalTransaction,
  rollbackReservedWithdrawal,
} from "../../service/payment/withdrawal.service.js";
import { enqueueWithdrawalJob } from "../../queue/withdrawal.queue.js";
import { logger } from "../../util/logger.util.js";
import { resolveTronTransactionSigner } from "../../util/tatumSigner.util.js";
import {
  getConfiguredTronTokenAddress,
  getConfiguredTronTransferCurrency,
  submitTatumTronTransfer,
} from "../../util/tronTransfer.util.js";

const TRX_CURRENCY = "TRX";

// ======== Get Transak Environment Config (1) ========
/**
 * Resolve Transak environment-specific URLs from runtime config.
 * Keeping this in one place avoids mismatched hosts across on-ramp
 * and off-ramp flows.
 */
const getTransakEnvironmentConfig = () => {
  const isDevelopment = process.env.NODE_ENV === "development";

  const appHostUrl =
    process.env.TRANSAK_HOST_URL ||
    (isDevelopment
      ? "http://localhost:8000"
      : "https://moneymatrixapp.com");

  const configuredReferrerDomain = String(
    process.env.TRANSAK_REFERRER_DOMAIN || ""
  )
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  return {
    appHostUrl,
    referrerDomain: configuredReferrerDomain || new URL(appHostUrl).host,
    sessionApiUrl: isDevelopment
      ? "https://api-gateway-stg.transak.com/api/v2/auth/session"
      : "https://api-gateway.transak.com/api/v2/auth/session",
  };
};

// ======== Create Transak Widget URL (2) ========
/**
 * Create a hosted Transak widget session.
 * We centralize this so both buy and sell flows use the same token
 * and session-creation rules.
 */
const createTransakWidgetUrl = async (widgetParams) => {
  const accessToken = (await generateTransakAccessToken())?.accessToken;

  if (!accessToken) {
    throw new ApiError(500, "Transak token missing");
  }

  const { sessionApiUrl } = getTransakEnvironmentConfig();

  let data;

  try {
    const response = await axios.post(
      sessionApiUrl,
      { widgetParams },
      {
        headers: {
          "access-token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    data = response.data;
  } catch (error) {
    const statusCode = error?.response?.status || 500;
    const transakMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to create Transak widget URL";

    const hint =
      statusCode === 401
        ? " Check your production Transak API key/secret pairing, whitelisted backend IP, and TRANSAK_REFERRER_DOMAIN."
        : "";

    throw new ApiError(statusCode, `${transakMessage}${hint}`);
  }

  if (!data?.data?.widgetUrl) {
    throw new ApiError(500, "Failed to generate widget URL");
  }

  console.info("TRANSAK_WIDGET_PARAMS", widgetParams);
  console.info("TRANSAK_WIDGET_URL", data.data.widgetUrl);

  return data.data.widgetUrl;
};

const getTransakNetwork = (cryptoCurrencyCode) => {
  const normalizedCryptoCurrencyCode = String(
    cryptoCurrencyCode || ""
  ).toUpperCase();

  if (normalizedCryptoCurrencyCode === "TRX") {
    return "tron";
  }

  return "mainnet";
};

const normalizeTransakPartnerId = (value, fieldName) => {
  const normalizedValue = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!normalizedValue) {
    throw new ApiError(400, `${fieldName} is invalid for Transak`);
  }

  return normalizedValue;
};

// ======== Get Transaction Amount In SUN (5) ========
/**
 * Read transaction amount from integer accounting when available.
 * This protects sweep and withdrawal paths from legacy documents that
 * do not yet contain the new amountSun field.
 */
const getTransactionAmountSun = (transaction) => {
  if (Number.isSafeInteger(transaction?.amountSun)) {
    return transaction.amountSun;
  }

  return trxToSun(transaction?.amount || 0, "Transaction amount");
};

// ======== Create Sweep Transaction Doc (6) ========
/**
 * Create a sweep transaction record if one does not already exist.
 * The externalId derived from the source chain tx keeps sweep creation
 * idempotent across retries.
 */
const createSweepTransactionDoc = async ({
  wallet,
  adminWallet,
  amountSun,
  sourceTxId,
  session = null,
}) => {
  const existingSweep = await Transaction.findOne({
    type: "SWEEP",
    externalId: `SWEEP:${sourceTxId}`,
  }).session(session);

  if (existingSweep) {
    return existingSweep;
  }

  const sweepPayload = [
    {
      userId: wallet.user,
      type: "SWEEP",
      ...buildAmountFieldsFromSun(amountSun),
      fromAddress: wallet.address,
      toAddress: adminWallet.address,
      externalId: `SWEEP:${sourceTxId}`,
      provider: "TATUM",
      currency: getConfiguredTronTransferCurrency(),
      status: "PENDING",
      processed: false,
      metadata: {
        tokenAddress: getConfiguredTronTokenAddress(),
      },
    },
  ];

  const [sweepTransaction] = session
    ? await Transaction.create(sweepPayload, { session })
    : await Transaction.create(sweepPayload);

  return sweepTransaction;
};

// ======== Create On Ramp URL (7) ========
/**
 * Create a local on-ramp transaction first, then return the hosted
 * Transak widget URL. Storing the local transaction before redirecting
 * gives webhook processing a stable internal record to update later.
 */
export const createOnRampUrl = AsyncHandler(async (req, res) => {
  // 1. Validate request
  const user = req.user;
  const {
    fiatAmount,
    countryCode = "IN",
    fiatCurrency = "INR",
  } = req.body;

  if (!fiatAmount || Number(fiatAmount) <= 0) {
    throw new ApiError(400, "Invalid fiat amount");
  }

  // 2. Load wallet and create a local pending transaction
  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) {
    throw new ApiError(404, "Wallet not found");
  }

  if (!wallet.address) {
    throw new ApiError(400, "Wallet address missing");
  }

  const externalId = crypto.randomUUID();

  await Transaction.create({
    userId: user._id,
    type: "DEPOSIT",
    externalId,
    toAddress: wallet.address,
    status: "PENDING",
    processed: false,
    amount: 0,
    amountSun: 0,
    provider: "TRANSAK",
    currency: TRX_CURRENCY,
    metadata: {
      fiatAmount: Number(fiatAmount),
      fiatCurrency: String(fiatCurrency).toUpperCase(),
      countryCode: String(countryCode).toUpperCase(),
    },
  });

  // 3. Create hosted checkout URL
  const { appHostUrl, referrerDomain } = getTransakEnvironmentConfig();

  const widgetParams = {
    apiKey: process.env.TRANSAK_API_KEY,
    productsAvailed: "BUY",
    partnerCustomerId: normalizeTransakPartnerId(
      user._id,
      "partnerCustomerId"
    ),
    partnerOrderId: normalizeTransakPartnerId(
      externalId,
      "partnerOrderId"
    ),
    cryptoCurrencyCode: TRX_CURRENCY,
    network: getTransakNetwork(TRX_CURRENCY),
    walletAddress: wallet.address,
    disableWalletAddressForm: true,
    ...(user?.email
      ? { email: user.email, isAutoFillUserData: true }
      : {}),
    fiatCurrency: String(fiatCurrency).toUpperCase(),
    countryCode: String(countryCode).toUpperCase(),
    defaultFiatAmount: Number(fiatAmount),
    hostURL: appHostUrl,
    redirectURL: `${appHostUrl}/api/v1/transak/on-ramp/success`,
    referrerDomain,
  };

  const url = await createTransakWidgetUrl(widgetParams);

  return res.json(
    new ApiResponse(
      200,
      { url, widgetUrl: url, orderId: externalId },
      "Success"
    )
  );
});

// ======== Sweep To Admin Wallet (8) ========
/**
 * Create or resume a sweep after a confirmed user deposit.
 * The deposit remains final even if the sweep later fails, so treasury
 * movement is handled as a separate concern from user crediting.
 */
export const sweepToAdminWallet = async ({
  userAddress,
  amount,
  amountSun,
  txId,
}) => {
  // 1. Validate input
  if (!userAddress || !txId) {
    throw new ApiError(400, "Invalid sweep data");
  }

  const normalizedAmountSun =
    amountSun !== undefined
      ? normalizeSunAmount(amountSun, "Sweep amount in SUN")
      : trxToSun(amount, "Sweep amount");

  if (normalizedAmountSun <= 0) {
    throw new ApiError(400, "Invalid sweep amount");
  }

  // 2. Load source and destination wallets
  const wallet = await Wallet.findOne({ address: userAddress });
  if (!wallet || wallet.isAdmin) {
    return null;
  }

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  // 3. Reserve network fee and create the sweep record
  const networkFeeSun = trxToSun(process.env.TRON_FEE || 1, "TRON_FEE");
  const sweepAmountSun = normalizedAmountSun - networkFeeSun;

  if (sweepAmountSun <= 0) {
    return null;
  }

  const sweepTransaction = await createSweepTransactionDoc({
    wallet,
    adminWallet,
    amountSun: sweepAmountSun,
    sourceTxId: txId,
  });

  return executePendingSweep(sweepTransaction._id);
};

// ======== Execute Pending Sweep (9) ========
/**
 * Execute a pending sweep transaction.
 * A separate execution step makes sweeps retryable without affecting
 * the already-finalized user deposit.
 */
export const executePendingSweep = async (sweepTransactionId) => {
  // 1. Load and pre-check the sweep transaction
  const sweepTransaction = await Transaction.findById(sweepTransactionId);
  if (!sweepTransaction) {
    throw new ApiError(404, "Sweep transaction not found");
  }

  if (
    sweepTransaction.processed &&
    sweepTransaction.status === "SUCCESS"
  ) {
    return sweepTransaction;
  }

  if (
    sweepTransaction.retryCount >= 5 &&
    sweepTransaction.status === "FAILED"
  ) {
    return sweepTransaction;
  }

  // 2. Load wallets
  const userWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ address: sweepTransaction.fromAddress })
  );

  if (!userWallet || userWallet.isAdmin) {
    throw new ApiError(400, "User wallet missing for sweep");
  }

  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true })
  );

  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  // 3. Lock the sweep so concurrent retries cannot run twice
  const lockedSweep = await Transaction.findOneAndUpdate(
    {
      _id: sweepTransaction._id,
      processed: false,
      status: { $in: ["PENDING", "PROCESSING", "FAILED"] },
      retryCount: { $lt: 5 },
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

  if (!lockedSweep) {
    return Transaction.findById(sweepTransaction._id);
  }

  if (lockedSweep.processed) {
    return lockedSweep;
  }

  // 4. Submit blockchain transfer
  const signer = resolveTronTransactionSigner(userWallet, {
    walletLabel: "User sweep wallet",
  });

  try {
    const response = await submitTatumTronTransfer({
      toAddress: adminWallet.address,
      amount: sunToTrx(getTransactionAmountSun(lockedSweep)).toString(),
      fromAddress: userWallet.address,
      tokenAddress: lockedSweep.metadata?.tokenAddress,
      signer,
    });

    // 5. Commit treasury credit and transaction success together
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const adminWalletInSession = await ensureWalletAccountingFields(
          adminWallet._id,
          session
        );

        await Wallet.updateOne(
          { _id: adminWalletInSession._id },
          {
            $inc: buildBalanceIncrementFromSun(
              getTransactionAmountSun(lockedSweep)
            ),
          },
          { session }
        );

        await Transaction.updateOne(
          { _id: lockedSweep._id, processed: false, status: "LOCKED" },
          {
            $set: {
              txId: response.data.txId,
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
  } catch (error) {
    // Sweep failure should be visible and retryable, but must not undo the
    // deposit that originally credited the user.
    await Transaction.updateOne(
      { _id: lockedSweep._id },
      {
        $set: {
          status: "FAILED",
          lockedAt: null,
          lastError: error?.response?.data?.message || error.message,
        },
        $inc: { retryCount: 1 },
      }
    );

    return Transaction.findById(lockedSweep._id);
  }

  return Transaction.findById(lockedSweep._id);
};

// ======== Check Admin Treasury Consistency (10) ========
/**
 * Compare treasury balance in MongoDB with the live on-chain balance.
 * This is intended as an operational safety check so accounting drift
 * is noticed early instead of being discovered during payout failures.
 */
export const checkAdminTreasuryConsistency = async () => {
  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true })
  );

  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  const response = await tatumClient.get(`/tron/account/${adminWallet.address}`);
  const chainBalanceTrx = Number(response?.data?.balance ?? 0);
  const chainBalanceSun = trxToSun(chainBalanceTrx, "On-chain TRX balance");
  const dbBalanceSun = getWalletBalanceSun(adminWallet);
  const mismatch = chainBalanceSun !== dbBalanceSun;

  if (mismatch) {
    console.error("TREASURY_BALANCE_MISMATCH", {
      adminWallet: adminWallet.address,
      dbBalanceSun,
      chainBalanceSun,
      differenceSun: chainBalanceSun - dbBalanceSun,
    });
  }

  return {
    walletAddress: adminWallet.address,
    dbBalanceSun,
    chainBalanceSun,
    differenceSun: chainBalanceSun - dbBalanceSun,
    mismatch,
  };
};

const buildTransakOffRampWidgetUrl = async ({
  user,
  externalId,
  amountSun,
  fiatCurrency,
  countryCode,
}) => {
  const { appHostUrl, referrerDomain } = getTransakEnvironmentConfig();

  return createTransakWidgetUrl({
    apiKey: process.env.TRANSAK_API_KEY,
    productsAvailed: "SELL",
    isBuyOrSell: "SELL",
    exchangeScreenTitle: "Sell Crypto",
    hideMenu: true,
    partnerCustomerId: normalizeTransakPartnerId(
      user._id,
      "partnerCustomerId"
    ),
    partnerOrderId: normalizeTransakPartnerId(
      externalId,
      "partnerOrderId"
    ),
    cryptoCurrencyCode: TRX_CURRENCY,
    network: getTransakNetwork(TRX_CURRENCY),
    ...(user?.email
      ? { email: user.email, isAutoFillUserData: true }
      : {}),
    defaultCryptoAmount: Number(sunToTrx(amountSun, "Off-ramp amount")),
    fiatCurrency: String(fiatCurrency).toUpperCase(),
    countryCode: String(countryCode).toUpperCase(),
    hostURL: appHostUrl,
    redirectURL: `${appHostUrl}/api/v1/transak/off-ramp/success`,
    referrerDomain,
    walletRedirection: true,
  });
};

const resolveUserTronDestinationAddress = async ({
  user,
  toAddress,
  label,
}) => {
  if (toAddress) {
    return assertValidTronAddress(toAddress, label);
  }

  if (user?.tronAddress) {
    return assertValidTronAddress(user.tronAddress, label);
  }

  const wallet = await Wallet.findOne({ user: user._id });

  if (wallet?.address) {
    return assertValidTronAddress(wallet.address, label);
  }

  throw new ApiError(
    400,
    `Missing ${label}. Create a wallet first or send toAddress explicitly`
  );
};

// ======== Withdraw TRX (11) ========
/**
 * Submit a direct TRX withdrawal.
 * The transaction intentionally remains in PROCESSING after submission so
 * on-chain confirmation can be finalized later by the webhook handler.
 */
export const withdrawTrx = AsyncHandler(async (req, res) => {
  const { amount, toAddress, tokenAddress } = req.body;
  const user = req.user;
  const amountSun = trxToSun(amount, "Withdraw amount");

  if (user?.role !== "admin" && !user?.isVerified) {
    throw new ApiError(403, "Please verify your account first");
  }

  if (amountSun <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const destinationAddress = await resolveUserTronDestinationAddress({
    user,
    toAddress,
    label: "destination address",
  });

  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true })
  );

  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  if (destinationAddress === adminWallet.address) {
    throw new ApiError(400, "Self-transfer to admin wallet is not allowed");
  }

  const withdrawalTransaction = await reserveWithdrawalTransaction({
    user,
    amountSun,
    destinationAddress,
    provider: "TATUM",
    currency: getConfiguredTronTransferCurrency({ tokenAddress }),
    status: "PENDING",
    deductUserBalance: user.role !== "admin",
    metadata: {
      queue: "withdrawal",
      requestedAt: new Date(),
      tokenAddress: getConfiguredTronTokenAddress({ tokenAddress }),
    },
  });

  try {
    const job = await enqueueWithdrawalJob(withdrawalTransaction._id.toString());

    await Transaction.updateOne(
      { _id: withdrawalTransaction._id, processed: false },
      {
        $set: {
          "metadata.queueJobId": job.id,
          "metadata.queueName": "trx-withdrawals",
        },
      }
    );

    logger.info("withdrawal.api.accepted", {
      transactionId: withdrawalTransaction._id.toString(),
      userId: user._id.toString(),
      amountSun,
      destinationAddress,
      jobId: job.id,
    });

    return res.json(
      new ApiResponse(
        202,
        {
          transactionId: withdrawalTransaction._id,
          status: "PENDING",
        },
        "Withdrawal queued for processing"
      )
    );
  } catch (error) {
    await rollbackReservedWithdrawal({
      user,
      amountSun,
      transactionFilter: { _id: withdrawalTransaction._id },
      error,
      refundUserBalance: user.role !== "admin",
    });

    throw new ApiError(
      503,
      error?.response?.data?.message ||
        error?.message ||
        "Withdrawal queue unavailable"
    );
  }
});

export const createOffRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;

  if (!user?._id) {
    throw new ApiError(401, "Unauthorized");
  }

  const {
    amount,
    fiatCurrency = "INR",
    countryCode = "IN",
  } = req.body;
  const amountSun = trxToSun(amount, "Off-ramp amount");

  if (!amountSun || amountSun <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const externalId = crypto.randomUUID();
  const normalizedFiatCurrency = String(fiatCurrency).toUpperCase();
  const normalizedCountryCode = String(countryCode).toUpperCase();

  try {
    const url = await buildTransakOffRampWidgetUrl({
      user,
      externalId,
      amountSun,
      fiatCurrency: normalizedFiatCurrency,
      countryCode: normalizedCountryCode,
    });

    if (!url) {
      throw new ApiError(500, "Failed to create Transak URL");
    }

    return res.json(
      new ApiResponse(200, {
        url,
        widgetUrl: url,
        orderId: externalId,
        note:
          "This only opens the external Transak sell flow. It does not withdraw or reserve in-game TRX.",
      })
    );
  } catch (error) {
    throw error;
  }
});
