// controllers/onramp.controller.js
import crypto from "crypto";
import { Wallet } from "../../model/wallet.model.js";
import { User } from "../../model/user.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { decrypt, derivePrivateKeyFromMnemonic } from "../../util/EncryptDecrypt.util.js";
import { Transaction } from "../../model/transaction.model.js";


// real money ---> crypto 
export const createOnRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;

  if (!user?.tronAddress) {
    throw new ApiError(400, "Tron address not found");
  }

  const isDev = process.env.NODE_ENV === "development";

  const baseUrl = isDev
    ? "https://delphia-synostotic-fletcher.ngrok-free.dev"
    : "https://moneymatrixapp.com";

  const transakUrl = isDev
    ? "https://global-stg.transak.com"
    : "https://global.transak.com";

  const params = new URLSearchParams({
    apiKey: process.env.TRANSAK_API_KEY,
    environment: isDev ? "STAGING" : "PRODUCTION",

    // 🔑 important additions
    products: "BUY",
    partnerCustomerId: user._id.toString(),

    defaultCryptoCurrency: "TRX",
    walletAddress: user.tronAddress,
    disableWalletAddressForm: "true",

    fiatCurrency: "INR",
    defaultFiatAmount: "1000",

    hostURL: baseUrl,
    redirectURL: `${baseUrl}/transak/success`,
    referrerDomain: isDev
      ? "delphia-synostotic-fletcher.ngrok-free.dev"
      : "moneymatrixapp.com",
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      { url: `${transakUrl}?${params.toString()}` },
      "On-ramp URL generated successfully"
    )
  );
});


// user wallet ---> admin wallet

export const sweepToAdminWallet = async (req, res, next) => {
  let sweepTx;

  try {
    const { userAddress, amount, txId } = req.body;

    if (!userAddress || !amount || !txId) {
      throw new ApiError(400, "Invalid sweep payload");
    }

    const exists = await Transaction.findOne({ txId });
    if (exists) {
      return { success: true };
    }

    const wallet = await Wallet.findOne({ address: userAddress });
    if (!wallet) throw new ApiError(404, "Wallet not found");
    if (wallet.isAdmin) throw new ApiError(400, "Cannot sweep admin");

    const adminWallet = await Wallet.findOne({ isAdmin: true });
    if (!adminWallet) throw new ApiError(500, "Admin wallet missing");

    const mnemonic = decrypt(wallet.mnemonic);
    const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

    const NETWORK_FEE = 1.5;
    const sweepAmount = amount - NETWORK_FEE;

    if (sweepAmount <= 0) {
      return { success: false };
    }

    sweepTx = await Transaction.create({
      userId: wallet.user,
      type: "SWEEP",
      amount: sweepAmount,
      fromAddress: userAddress,
      toAddress: adminWallet.address,
      txId,
      status: "PENDING",
    });

    const response = await tatumClient.post("/tron/transaction", {
      to: adminWallet.address,
      amount: sweepAmount.toString(),
      privateKey,
    });

    // atomic update
    await Wallet.findOneAndUpdate(
      { isAdmin: true },
      { $inc: { balance: sweepAmount } }
    );

    sweepTx.status = "SUCCESS";
    sweepTx.txId = response.data.txId;
    await sweepTx.save();

    return { success: true };

  } catch (err) {
    if (sweepTx) {
      sweepTx.status = "FAILED";
      await sweepTx.save();
    }

    if (next) return next(err);
    throw new ApiError(500, "Sweep failed");
  }
};


// admin wallet -----> user wallet only 

export const withdrawTrx = AsyncHandler(async (req, res) => {
  const { amount, toAddress } = req.body;
  const user = req.user;

  if (!amount || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  if (!toAddress) {
    throw new ApiError(400, "Destination address required");
  }

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) throw new ApiError(500, "Admin wallet missing");
  if (!adminWallet.mnemonic) throw new ApiError(500, "Admin wallet mnemonic missing");

  if (adminWallet.balance < amount) {
    throw new ApiError(400, "Admin insufficient balance");
  }

  const mnemonic = decrypt(adminWallet.mnemonic);
  const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

  // 🔴 deduct user
  if (user.role !== "admin") {
    const updated = await Wallet.findOneAndUpdate(
      { user: user._id, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true }
    );

    if (!updated) throw new ApiError(400, "Insufficient balance");
  }

  const tx = await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount,
    status: "PENDING",
    fromAddress: adminWallet.address,
    toAddress,
  });

  try {
    const response = await tatumClient.post("/tron/transaction", {
      to: toAddress,
      amount: amount.toString(),
      privateKey,
    });

    // deduct admin atomically
    await Wallet.findOneAndUpdate(
      { isAdmin: true, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );

    tx.txId = response.data.txId;
    await tx.save(); // keep PENDING

    return res.status(200).json(
      new ApiResponse(200, { txId: tx.txId }, "Withdraw initiated")
    );

  } catch (err) {
    if (user.role !== "admin") {
      await Wallet.updateOne(
        { user: user._id },
        { $inc: { balance: amount } }
      );
    }

    tx.status = "FAILED";
    await tx.save();

    throw new ApiError(500, "Withdraw failed");
  }
});

// real crypto ---> bank account (fiat)
export const createOffRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  if (!user?.tronAddress) {
    throw new ApiError(400, "User wallet address missing");
  }

  // 🟢 Environment handling
  const isDev = process.env.NODE_ENV === "development";

  const baseUrl = isDev
    ? "https://delphia-synostotic-fletcher.ngrok-free.dev"
    : "https://moneymatrixapp.com";

  const transakUrl = isDev
    ? "https://global-stg.transak.com"
    : "https://global.transak.com";

  // 🟢 STEP 1: Deduct user balance (atomic)
  const wallet = await Wallet.findOneAndUpdate(
    { user: user._id, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );

  if (!wallet) {
    throw new ApiError(400, "Insufficient balance");
  }

  // 🟢 STEP 2: Create internal transaction
  const tx = await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount,
    status: "PENDING",
    externalId: crypto.randomUUID(),
  });

  // 🟢 STEP 3: Build Transak SELL URL
  const params = new URLSearchParams({
    apiKey: process.env.TRANSAK_API_KEY,
    environment: isDev ? "STAGING" : "PRODUCTION",

    // 🔥 IMPORTANT
    products: "AUTO_SELL",
    partnerCustomerId: user._id.toString(),

    defaultCryptoCurrency: "TRX",
    walletAddress: user.tronAddress,
    disableWalletAddressForm: "true",

    cryptoAmount: amount.toString(),
    fiatCurrency: "INR",

    // 🔗 tracking & redirect
    hostURL: baseUrl,
    redirectURL: `${baseUrl}/transak/offramp-success`,

    // 🧠 VERY IMPORTANT FOR TRACKING
    partnerOrderId: tx.externalId,
  });

  const url = `${transakUrl}?${params.toString()}`;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        url,
        transactionId: tx._id,
      },
      "Off-ramp URL generated"
    )
  );
});
