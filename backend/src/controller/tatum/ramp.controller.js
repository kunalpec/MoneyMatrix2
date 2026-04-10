import crypto from "crypto";
import axios from "axios";
import { Wallet } from "../../model/wallet.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { generateTransakAccessToken } from "./transak.controller.js";
import { decrypt, derivePrivateKeyFromMnemonic } from "../../util/EncryptDecrypt.util.js";
import { Transaction } from "../../model/transaction.model.js";


// ================= ENV CONFIG =================
const getTransakEnvironmentConfig = () => {
  const isDev = process.env.NODE_ENV === "development";

  const hostUrl =
    process.env.TRANSAK_HOST_URL ||
    (isDev
      ? "https://your-ngrok-url.ngrok-free.app"
      : "https://yourdomain.com");

  return {
    hostUrl,
    referrerDomain: new URL(hostUrl).host,
    sessionApiUrl: isDev
      ? "https://api-gateway-stg.transak.com/api/v2/auth/session"
      : "https://api-gateway.transak.com/api/v2/auth/session",
  };
};


// ================= CREATE TRANSAK URL =================
const createTransakWidgetUrl = async (widgetParams) => {
  const accessToken =
    process.env.TRANSAK_ACCESS_TOKEN ||
    (await generateTransakAccessToken())?.accessToken;

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


// ================= ONRAMP =================
export const createOnRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;
  const { fiatAmount, countryCode = "IN" } = req.body;

  if (!user?.tronAddress) {
    throw new ApiError(400, "User wallet missing");
  }

  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) throw new ApiError(404, "Wallet not found");

  const externalId = crypto.randomUUID();

  await Transaction.create({
    userId: user._id,
    type: "DEPOSIT",
    externalId,
    toAddress: wallet.address,
    status: "PENDING",
  });

  const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();

  const widgetParams = {
    apiKey: process.env.TRANSAK_API_KEY,
    productsAvailed: "BUY",
    partnerCustomerId: user._id.toString(),
    partnerOrderId: externalId,
    cryptoCurrencyCode: "TRX",
    network: "mainnet",
    walletAddress: wallet.address,
    disableWalletAddressForm: true,
    fiatCurrency: "INR",
    countryCode,
    defaultFiatAmount: Number(fiatAmount),
    hostURL: hostUrl,
    redirectURL: `${hostUrl}/success`,
    referrerDomain,
  };

  const url = await createTransakWidgetUrl(widgetParams);

  return res.json(
    new ApiResponse(200, { url, orderId: externalId }, "Success")
  );
});


// ================= SWEEP TO ADMIN =================
export const sweepToAdminWallet = async ({ userAddress, amount, txId }) => {
  if (!userAddress || !amount || !txId) {
    throw new ApiError(400, "Invalid sweep data");
  }

  // 🔒 prevent duplicate sweep
  const exists = await Transaction.findOne({
    txId,
    type: "SWEEP",
  });

  if (exists) return;

  const wallet = await Wallet.findOne({ address: userAddress });
  if (!wallet || wallet.isAdmin) return;

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) throw new ApiError(500, "Admin wallet missing");

  const mnemonic = decrypt(wallet.mnemonic);
  const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

  const NETWORK_FEE = Number(process.env.TRON_FEE || 1);
  const sweepAmount = amount - NETWORK_FEE;

  if (sweepAmount <= 0) return;

  const sweepTx = await Transaction.create({
    userId: wallet.user,
    type: "SWEEP",
    amount: sweepAmount,
    fromAddress: userAddress,
    toAddress: adminWallet.address,
    txId,
    status: "PENDING",
  });

  try {
    const response = await tatumClient.post("/tron/transaction", {
      to: adminWallet.address,
      amount: sweepAmount.toString(),
      privateKey,
    });

    await Wallet.updateOne(
      { isAdmin: true },
      { $inc: { balance: sweepAmount } }
    );

    sweepTx.status = "SUCCESS";
    sweepTx.txId = response.data.txId;
    await sweepTx.save();
  } catch (err) {
    sweepTx.status = "FAILED";
    await sweepTx.save();
    throw err;
  }
};


// ================= WITHDRAW =================
export const withdrawTrx = AsyncHandler(async (req, res) => {
  const { amount, toAddress } = req.body;
  const user = req.user;

  if (!amount || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) throw new ApiError(500, "Admin wallet missing");

  if (adminWallet.balance < amount) {
    throw new ApiError(400, "Admin insufficient balance");
  }

  // 🔒 deduct user balance first
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
    toAddress,
  });

  try {
    const mnemonic = decrypt(adminWallet.mnemonic);
    const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

    const response = await tatumClient.post("/tron/transaction", {
      to: toAddress,
      amount: amount.toString(),
      privateKey,
    });

    await Wallet.updateOne(
      { isAdmin: true },
      { $inc: { balance: -amount } }
    );

    tx.txId = response.data.txId;
    tx.status = "SUCCESS";
    tx.completedAt = new Date();
    await tx.save();

    return res.json(new ApiResponse(200, { txId: tx.txId }));
  } catch (err) {
    // rollback user balance
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


// ================= OFFRAMP =================
export const createOffRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const wallet = await Wallet.findOneAndUpdate(
    { user: user._id, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );

  if (!wallet) throw new ApiError(400, "Insufficient balance");

  const externalId = crypto.randomUUID();

  await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount,
    externalId,
    status: "PENDING",
  });

  try {
    const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();

    const widgetParams = {
      apiKey: process.env.TRANSAK_API_KEY,
      productsAvailed: "SELL",
      partnerCustomerId: user._id.toString(),
      partnerOrderId: externalId,
      cryptoCurrencyCode: "TRX",
      network: "mainnet",
      walletAddress: user.tronAddress,
      cryptoAmount: amount.toString(),
      fiatCurrency: "INR",
      hostURL: hostUrl,
      redirectURL: `${hostUrl}/offramp-success`,
      referrerDomain,
    };

    const url = await createTransakWidgetUrl(widgetParams);

    return res.json(new ApiResponse(200, { url }));
  } catch (err) {
    await Wallet.updateOne(
      { user: user._id },
      { $inc: { balance: amount } }
    );

    await Transaction.updateOne(
      { externalId },
      {
        status: "FAILED",
        processed: true,
        lastError: err.message,
      }
    );

    throw err;
  }
});
