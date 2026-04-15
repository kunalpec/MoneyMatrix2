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

export const createOnRampUrl = AsyncHandler(async (req, res) => {
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
    cryptoCurrencyCode: String(cryptoCurrencyCode).toUpperCase(),
    network: "mainnet",
    walletAddress: wallet.address,
    disableWalletAddressForm: true,
    fiatCurrency: String(fiatCurrency).toUpperCase(),
    countryCode: String(countryCode).toUpperCase(),
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

export const sweepToAdminWallet = async ({ userAddress, amount, txId }) => {
  if (!userAddress || !amount || !txId) {
    throw new ApiError(400, "Invalid sweep data");
  }

  const exists = await Transaction.findOne({
    type: "SWEEP",
    $or: [{ externalId: txId }, { txId }],
  });

  if (exists) return exists;

  const wallet = await Wallet.findOne({ address: userAddress });
  if (!wallet || wallet.isAdmin) return null;

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) throw new ApiError(500, "Admin wallet missing");

  const mnemonic = decrypt(wallet.mnemonic);
  const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

  const networkFee = Number(process.env.TRON_FEE || 1);
  const sweepAmount = Number(amount) - networkFee;

  if (sweepAmount <= 0) return null;

  const sweepTx = await Transaction.create({
    userId: wallet.user,
    type: "SWEEP",
    amount: sweepAmount,
    fromAddress: userAddress,
    toAddress: adminWallet.address,
    externalId: txId,
    txId,
    status: "PENDING",
  });

  try {
    const response = await tatumClient.post("/tron/transaction", {
      to: adminWallet.address,
      amount: sweepAmount.toString(),
      fromPrivateKey: privateKey,
    });

    await Wallet.updateOne(
      { isAdmin: true },
      { $inc: { balance: sweepAmount } }
    );

    sweepTx.status = "SUCCESS";
    sweepTx.txId = response.data.txId;
    sweepTx.processed = true;
    sweepTx.processedAt = new Date();
    await sweepTx.save();
  } catch (err) {
    sweepTx.status = "FAILED";
    sweepTx.lastError = err?.response?.data?.message || err.message;
    await sweepTx.save();
    throw err;
  }

  return sweepTx;
};

export const withdrawTrx = AsyncHandler(async (req, res) => {
  const { amount, toAddress } = req.body;
  const user = req.user;

  if (!amount || Number(amount) <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const adminWallet = await Wallet.findOne({ isAdmin: true });
  if (!adminWallet) throw new ApiError(500, "Admin wallet missing");

  if (adminWallet.balance < Number(amount)) {
    throw new ApiError(400, "Admin insufficient balance");
  }

  if (user.role !== "admin") {
    const updated = await Wallet.findOneAndUpdate(
      { user: user._id, balance: { $gte: Number(amount) } },
      { $inc: { balance: -Number(amount) } },
      { returnDocument: "after" }
    );

    if (!updated) throw new ApiError(400, "Insufficient balance");
  }

  const tx = await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount: Number(amount),
    status: "PENDING",
    toAddress,
  });

  try {
    const mnemonic = decrypt(adminWallet.mnemonic);
    const privateKey = derivePrivateKeyFromMnemonic(mnemonic);

    const response = await tatumClient.post("/tron/transaction", {
      to: toAddress,
      amount: Number(amount).toString(),
      fromPrivateKey: privateKey,
    });

    await Wallet.updateOne(
      { isAdmin: true },
      { $inc: { balance: -Number(amount) } }
    );

    tx.txId = response.data.txId;
    tx.status = "SUCCESS";
    tx.processed = true;
    tx.processedAt = new Date();
    tx.completedAt = new Date();
    await tx.save();

    return res.json(new ApiResponse(200, { txId: tx.txId }));
  } catch (err) {
    if (user.role !== "admin") {
      await Wallet.updateOne(
        { user: user._id },
        { $inc: { balance: Number(amount) } }
      );
    }

    tx.status = "FAILED";
    tx.lastError = err?.response?.data?.message || err.message;
    await tx.save();

    throw new ApiError(500, "Withdraw failed");
  }
});

export const createOffRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;
  const {
    amount,
    fiatCurrency = "INR",
    countryCode = "IN",
    cryptoCurrencyCode = "TRX",
  } = req.body;

  if (!amount || Number(amount) <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  const wallet = await Wallet.findOneAndUpdate(
    { user: user._id, balance: { $gte: Number(amount) } },
    { $inc: { balance: -Number(amount) } },
    { returnDocument: "after" }
  );

  if (!wallet) throw new ApiError(400, "Insufficient balance");

  const externalId = crypto.randomUUID();

  await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount: Number(amount),
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
      cryptoCurrencyCode: String(cryptoCurrencyCode).toUpperCase(),
      network: "mainnet",
      walletAddress: user.tronAddress,
      cryptoAmount: Number(amount).toString(),
      fiatCurrency: String(fiatCurrency).toUpperCase(),
      countryCode: String(countryCode).toUpperCase(),
      hostURL: hostUrl,
      redirectURL: `${hostUrl}/offramp-success`,
      referrerDomain,
    };

    const url = await createTransakWidgetUrl(widgetParams);

    return res.json(new ApiResponse(200, { url }));
  } catch (err) {
    await Wallet.updateOne(
      { user: user._id },
      { $inc: { balance: Number(amount) } }
    );

    await Transaction.updateOne(
      { externalId },
      {
        status: "FAILED",
        processed: true,
        processedAt: new Date(),
        lastError: err.message,
      }
    );

    throw err;
  }
});
