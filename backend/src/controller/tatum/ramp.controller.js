import crypto from "crypto";
import axios from "axios";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { generateTransakAccessToken } from "./transak.controller.js";
import {
  decrypt,
  derivePrivateKeyFromMnemonic,
} from "../../util/EncryptDecrypt.util.js";
import { Transaction } from "../../model/transaction.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  normalizeSunAmount,
  sunToTrx,
  trxToSun,
} from "../../util/trxAmount.util.js";
import { assertValidTronAddress } from "../../util/tronAddress.util.js";

// ======== Get Transak Environment Config (1) ========
/**
 * Resolve Transak environment-specific URLs from runtime config.
 * Keeping this in one place avoids mismatched hosts across on-ramp
 * and off-ramp flows.
 */
const getTransakEnvironmentConfig = () => {
  const isDevelopment = process.env.NODE_ENV === "development";

  const hostUrl =
    process.env.TRANSAK_HOST_URL ||
    (isDevelopment
      ? "https://your-ngrok-url.ngrok-free.app"
      : "https://yourdomain.com");

  return {
    hostUrl,
    referrerDomain: new URL(hostUrl).host,
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

  const { data } = await axios.post(
    sessionApiUrl,
    { widgetParams },
    {
      headers: {
        "access-token": accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  if (!data?.data?.widgetUrl) {
    throw new ApiError(500, "Failed to generate widget URL");
  }

  return data.data.widgetUrl;
};

// ======== Ensure Wallet Accounting Fields (3) ========
/**
 * Backfill integer accounting fields lazily for older wallet documents.
 * This keeps payment logic safe during rollout without requiring an
 * immediate hard migration before the controller can run.
 */
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

  return Wallet.findByIdAndUpdate(
    wallet._id,
    { $set: update },
    { new: true, session }
  );
};

// ======== Get Wallet Balance In SUN (4) ========
/**
 * Read wallet balance from integer accounting when available.
 * Falling back to the legacy decimal field keeps older data usable
 * while the system transitions to SUN-based accounting.
 */
const getWalletBalanceSun = (wallet) => {
  if (Number.isSafeInteger(wallet?.balanceSun)) {
    return wallet.balanceSun;
  }

  return trxToSun(wallet?.balance || 0, "Wallet balance");
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
      currency: "TRX",
      status: "PENDING",
      processed: false,
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
    cryptoCurrencyCode = "TRX",
  } = req.body;

  if (!user?.tronAddress) {
    throw new ApiError(400, "User wallet missing");
  }

  if (!fiatAmount || Number(fiatAmount) <= 0) {
    throw new ApiError(400, "Invalid fiat amount");
  }

  // 2. Load wallet and create a local pending transaction
  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) {
    throw new ApiError(404, "Wallet not found");
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
    currency: String(cryptoCurrencyCode).toUpperCase(),
    metadata: {
      fiatAmount: Number(fiatAmount),
      fiatCurrency: String(fiatCurrency).toUpperCase(),
      countryCode: String(countryCode).toUpperCase(),
    },
  });

  // 3. Create hosted checkout URL
  const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();

  const widgetParams = {
    apiKey: process.env.TRANSAK_API_KEY,
    productsAvailed: "BUY",
    partnerCustomerId: user._id.toString(),
    partnerOrderId: externalId,
    cryptoCurrencyCode: String(cryptoCurrencyCode).toUpperCase(),
    network: "mainnet",
    walletAddress: wallet.address,
    disableWalletAddressForm: true,
    fiatCurrency: String(fiatCurrency).toUpperCase(),
    countryCode: String(countryCode).toUpperCase(),
    defaultFiatAmount: Number(fiatAmount),
    hostURL: hostUrl,
    redirectURL: `${hostUrl}/api/v1/transak/success`,
    referrerDomain,
  };

  const url = await createTransakWidgetUrl(widgetParams);

  return res.json(new ApiResponse(200, { url, orderId: externalId }, "Success"));
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
    { new: true }
  );

  if (!lockedSweep) {
    return Transaction.findById(sweepTransaction._id);
  }

  if (lockedSweep.processed) {
    return lockedSweep;
  }

  // 4. Submit blockchain transfer
  const mnemonic = decrypt(userWallet.mnemonic);
  const privateKey = derivePrivateKeyFromMnemonic(
    mnemonic,
    userWallet.index || 0
  );

  try {
    const response = await tatumClient.post("/tron/transaction", {
      to: adminWallet.address,
      amount: sunToTrx(getTransactionAmountSun(lockedSweep)).toString(),
      fromPrivateKey: privateKey,
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

// ======== Withdraw TRX (11) ========
/**
 * Submit a direct TRX withdrawal.
 * The transaction intentionally remains in PROCESSING after submission so
 * on-chain confirmation can be finalized later by the webhook handler.
 */
export const withdrawTrx = AsyncHandler(async (req, res) => {
  // 1. Validate request
  const { amount, toAddress } = req.body;
  const user = req.user;
  const amountSun = trxToSun(amount, "Withdraw amount");

  if (amountSun <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const destinationAddress = assertValidTronAddress(
    toAddress,
    "destination address"
  );

  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true })
  );

  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  if (destinationAddress === adminWallet.address) {
    throw new ApiError(400, "Self-transfer to admin wallet is not allowed");
  }

  if (getWalletBalanceSun(adminWallet) < amountSun) {
    throw new ApiError(400, "Admin insufficient balance");
  }

  // 2. Reserve user balance and create the local withdrawal record
  const creationSession = await mongoose.startSession();
  let withdrawalTransaction;
  let chainSubmitted = false;
  let submittedTxId = null;

  try {
    await creationSession.withTransaction(async () => {
      if (user.role !== "admin") {
        const userWallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(creationSession),
          creationSession
        );

        if (!userWallet) {
          throw new ApiError(404, "Wallet not found");
        }

        const updatedWallet = await Wallet.findOneAndUpdate(
          {
            _id: userWallet._id,
            balanceSun: { $gte: amountSun },
          },
          {
            $inc: buildBalanceIncrementFromSun(-amountSun),
          },
          { new: true, session: creationSession }
        );

        if (!updatedWallet) {
          throw new ApiError(400, "Insufficient balance");
        }
      }

      [withdrawalTransaction] = await Transaction.create(
        [
          {
            userId: user._id,
            type: "WITHDRAW",
            ...buildAmountFieldsFromSun(amountSun),
            status: "PROCESSING",
            processed: false,
            toAddress: destinationAddress,
            provider: "TATUM",
            currency: "TRX",
          },
        ],
        { session: creationSession }
      );
    });
  } finally {
    await creationSession.endSession();
  }

  try {
    // 3. Submit blockchain transaction
    const mnemonic = decrypt(adminWallet.mnemonic);
    const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

    const response = await tatumClient.post("/tron/transaction", {
      to: destinationAddress,
      amount: sunToTrx(amountSun).toString(),
      fromPrivateKey: privateKey,
    });

    chainSubmitted = true;
    submittedTxId = response.data.txId;

    // 4. Persist chain txId and treasury debit, but do not mark success yet.
    // Final success is reserved for webhook confirmation.
    const finalizeSession = await mongoose.startSession();

    try {
      await finalizeSession.withTransaction(async () => {
        const updatedTransaction = await Transaction.findOneAndUpdate(
          {
            _id: withdrawalTransaction._id,
            processed: false,
            status: "PROCESSING",
          },
          {
            $set: {
              txId: submittedTxId,
              status: "PROCESSING",
              lastError: null,
            },
          },
          { new: true, session: finalizeSession }
        );

        if (!updatedTransaction) {
          throw new ApiError(
            409,
            "Withdrawal transaction not available for txId update"
          );
        }

        const adminWalletInSession = await ensureWalletAccountingFields(
          adminWallet._id,
          finalizeSession
        );

        const debitedAdminWallet = await Wallet.findOneAndUpdate(
          {
            _id: adminWalletInSession._id,
            balanceSun: { $gte: amountSun },
          },
          { $inc: buildBalanceIncrementFromSun(-amountSun) },
          { new: true, session: finalizeSession }
        );

        if (!debitedAdminWallet) {
          throw new ApiError(
            409,
            "Admin balance changed before withdrawal finalization"
          );
        }
      });
    } finally {
      await finalizeSession.endSession();
    }

    return res.json(
      new ApiResponse(200, { txId: submittedTxId }, "Withdrawal submitted")
    );
  } catch (error) {
    // 5. If the chain submission already happened, do not mark the transaction
    // as failed and do not refund the user. The safe fallback is to keep it in
    // PROCESSING until webhook confirmation or manual recovery.
    if (chainSubmitted) {
      console.error("WITHDRAW_DB_FINALIZATION_FAILED_AFTER_CHAIN_SUBMISSION", {
        transactionId: withdrawalTransaction?._id?.toString?.(),
        txId: submittedTxId,
        error: error?.message,
      });

      await Transaction.updateOne(
        { _id: withdrawalTransaction._id, processed: false },
        {
          $set: {
            txId: submittedTxId,
            status: "PROCESSING",
            lastError: error?.response?.data?.message || error.message,
          },
        }
      );

      return res.json(
        new ApiResponse(
          200,
          { txId: submittedTxId },
          "Withdrawal submitted and awaiting webhook confirmation"
        )
      );
    }

    // 6. Only before chain submission is it safe to roll back local state.
    const rollbackSession = await mongoose.startSession();

    try {
      await rollbackSession.withTransaction(async () => {
        if (user.role !== "admin") {
          const userWallet = await ensureWalletAccountingFields(
            await Wallet.findOne({ user: user._id }).session(rollbackSession),
            rollbackSession
          );

          await Wallet.updateOne(
            { _id: userWallet._id },
            { $inc: buildBalanceIncrementFromSun(amountSun) },
            { session: rollbackSession }
          );
        }

        await Transaction.updateOne(
          { _id: withdrawalTransaction._id, processed: false },
          {
            $set: {
              status: "FAILED",
              processed: true,
              processedAt: new Date(),
              lastError: error?.response?.data?.message || error.message,
            },
          },
          { session: rollbackSession }
        );
      });
    } finally {
      await rollbackSession.endSession();
    }

    throw new ApiError(500, "Withdraw failed");
  }
});

// ======== Create Off Ramp URL (12) ========
/**
 * Create a Transak sell session and reserve the user's internal balance first.
 * The balance reservation and local transaction creation happen before the
 * redirect so failures can be rolled back deterministically.
 */
export const createOffRampUrl = AsyncHandler(async (req, res) => {
  // 1. Validate request
  const user = req.user;
  const {
    amount,
    fiatCurrency = "INR",
    countryCode = "IN",
    cryptoCurrencyCode = "TRX",
  } = req.body;

  const amountSun = trxToSun(amount, "Off-ramp amount");

  if (amountSun <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  // 2. Reserve user balance and create a local pending withdrawal
  const session = await mongoose.startSession();
  let externalId = crypto.randomUUID();

  try {
    await session.withTransaction(async () => {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: user._id }).session(session),
        session
      );

      if (!wallet) {
        throw new ApiError(404, "Wallet not found");
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          _id: wallet._id,
          balanceSun: { $gte: amountSun },
        },
        {
          $inc: buildBalanceIncrementFromSun(-amountSun),
        },
        { new: true, session }
      );

      if (!updatedWallet) {
        throw new ApiError(400, "Insufficient balance");
      }

      await Transaction.create(
        [
          {
            userId: user._id,
            type: "WITHDRAW",
            ...buildAmountFieldsFromSun(amountSun),
            externalId,
            status: "PENDING",
            processed: false,
            provider: "TRANSAK",
            currency: String(cryptoCurrencyCode).toUpperCase(),
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  try {
    // 3. Create hosted off-ramp widget
    const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();

    const widgetParams = {
      apiKey: process.env.TRANSAK_API_KEY,
      productsAvailed: "SELL",
      partnerCustomerId: user._id.toString(),
      partnerOrderId: externalId,
      cryptoCurrencyCode: String(cryptoCurrencyCode).toUpperCase(),
      network: "mainnet",
      walletAddress: user.tronAddress,
      cryptoAmount: sunToTrx(amountSun).toString(),
      fiatCurrency: String(fiatCurrency).toUpperCase(),
      countryCode: String(countryCode).toUpperCase(),
      hostURL: hostUrl,
      redirectURL: `${hostUrl}/offramp-success`,
      referrerDomain,
    };

    const url = await createTransakWidgetUrl(widgetParams);

    return res.json(new ApiResponse(200, { url, orderId: externalId }));
  } catch (error) {
    // 4. If widget creation fails, roll back the reserved balance and mark
    // the local withdrawal as failed so the user is not stuck.
    const rollbackSession = await mongoose.startSession();

    try {
      await rollbackSession.withTransaction(async () => {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(rollbackSession),
          rollbackSession
        );

        await Wallet.updateOne(
          { _id: wallet._id },
          { $inc: buildBalanceIncrementFromSun(amountSun) },
          { session: rollbackSession }
        );

        await Transaction.updateOne(
          { externalId, processed: false },
          {
            $set: {
              status: "FAILED",
              processed: true,
              processedAt: new Date(),
              lastError: error.message,
            },
          },
          { session: rollbackSession }
        );
      });
    } finally {
      await rollbackSession.endSession();
    }

    throw error;
  }
});
