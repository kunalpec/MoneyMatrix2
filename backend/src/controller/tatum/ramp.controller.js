// controllers/onramp.controller.js
import crypto from "crypto";
import axios from "axios";
import { Wallet } from "../../model/wallet.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { decrypt, derivePrivateKeyFromMnemonic } from "../../util/EncryptDecrypt.util.js";
import { Transaction } from "../../model/transaction.model.js";

let transakPartnerAccessToken = process.env.TRANSAK_ACCESS_TOKEN || "";
let transakPartnerAccessTokenExpiresAt = 0;

const getTransakEnvironmentConfig = () => {
  const isDev = process.env.NODE_ENV === "development";
  const hostUrl = process.env.TRANSAK_HOST_URL?.trim() || (
    isDev
      ? "https://delphia-synostotic-fletcher.ngrok-free.dev"
      : "https://moneymatrixapp.com"
  );
  const referrerDomain = process.env.TRANSAK_REFERRER_DOMAIN?.trim() || new URL(hostUrl).host;

  return {
    hostUrl,
    referrerDomain,
    sessionApiUrl: isDev
      ? "https://api-gateway-stg.transak.com/api/v2/auth/session"
      : "https://api-gateway.transak.com/api/v2/auth/session",
    refreshTokenApiUrl: isDev
      ? "https://api-stg.transak.com/partners/api/v2/refresh-token"
      : "https://api.transak.com/partners/api/v2/refresh-token",
  };
};

const getPartnerAccessToken = async () => {
  const now = Date.now();

  if (transakPartnerAccessToken && transakPartnerAccessTokenExpiresAt > now + 60_000) {
    return transakPartnerAccessToken;
  }

  if (process.env.TRANSAK_ACCESS_TOKEN) {
    transakPartnerAccessToken = process.env.TRANSAK_ACCESS_TOKEN;
    transakPartnerAccessTokenExpiresAt = now + 6 * 24 * 60 * 60 * 1000;
    return transakPartnerAccessToken;
  }

  if (!process.env.TRANSAK_API_SECRET) {
    throw new ApiError(
      500,
      "Transak is not configured. Set TRANSAK_ACCESS_TOKEN or TRANSAK_API_SECRET in backend/.env"
    );
  }

  const { refreshTokenApiUrl } = getTransakEnvironmentConfig();

  try {
    const { data } = await axios.post(
      refreshTokenApiUrl,
      { apiKey: process.env.TRANSAK_API_KEY },
      {
        headers: {
          "api-secret": process.env.TRANSAK_API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    transakPartnerAccessToken = data?.data?.accessToken;
    transakPartnerAccessTokenExpiresAt = (data?.data?.expiresAt || 0) * 1000;

    if (!transakPartnerAccessToken) {
      throw new Error("Missing access token in Transak response");
    }

    return transakPartnerAccessToken;
  } catch (error) {
    throw new ApiError(
      error?.response?.status || 502,
      error?.response?.data?.message || "Failed to fetch Transak partner access token"
    );
  }
};

const createTransakWidgetUrl = async (widgetParams) => {
  if (!process.env.TRANSAK_API_KEY) {
    throw new ApiError(500, "TRANSAK_API_KEY is missing in backend/.env");
  }

  const accessToken = await getPartnerAccessToken();
  const { sessionApiUrl } = getTransakEnvironmentConfig();

  try {
    const { data } = await axios.post(
      sessionApiUrl,
      { widgetParams },
      {
        headers: {
          "access-token": accessToken,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    const widgetUrl = data?.data?.widgetUrl;
    if (!widgetUrl) {
      throw new Error("Missing widgetUrl in Transak response");
    }

    return widgetUrl;
  } catch (error) {
    throw new ApiError(
      error?.response?.status || 502,
      error?.response?.data?.message || "Failed to create Transak widget URL"
    );
  }
};

// real money ---> crypto
export const createOnRampUrl = AsyncHandler(async (req, res) => {
  const user = req.user;

  if (!user?.tronAddress) {
    throw new ApiError(400, "Tron address not found");
  }

  const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();
  const widgetParams = {
    apiKey: process.env.TRANSAK_API_KEY,
    productsAvailed: "BUY",
    partnerCustomerId: user._id.toString(),
    cryptoCurrencyCode: "TRX",
    network: "mainnet",
    walletAddress: user.tronAddress,
    disableWalletAddressForm: true,
    fiatCurrency: "INR",
    fiatAmount: 1000,
    hostURL: hostUrl,
    redirectURL: `${hostUrl}/transak/success`,
    referrerDomain,
  };

  const url = await createTransakWidgetUrl(widgetParams);

  return res.status(200).json(
    new ApiResponse(200, { url }, "On-ramp URL generated successfully")
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

    await Wallet.findOneAndUpdate(
      { isAdmin: true, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );

    tx.txId = response.data.txId;
    await tx.save();

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

  const { hostUrl, referrerDomain } = getTransakEnvironmentConfig();

  const wallet = await Wallet.findOneAndUpdate(
    { user: user._id, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );

  if (!wallet) {
    throw new ApiError(400, "Insufficient balance");
  }

  const tx = await Transaction.create({
    userId: user._id,
    type: "WITHDRAW",
    amount,
    status: "PENDING",
    externalId: crypto.randomUUID(),
  });

  try {
    const widgetParams = {
      apiKey: process.env.TRANSAK_API_KEY,
      productsAvailed: "SELL",
      partnerCustomerId: user._id.toString(),
      partnerOrderId: tx.externalId,
      cryptoCurrencyCode: "TRX",
      network: "mainnet",
      walletAddress: user.tronAddress,
      disableWalletAddressForm: true,
      cryptoAmount: amount.toString(),
      fiatCurrency: "INR",
      hostURL: hostUrl,
      redirectURL: `${hostUrl}/transak/offramp-success`,
      referrerDomain,
      walletRedirection: true,
    };

    const url = await createTransakWidgetUrl(widgetParams);

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
  } catch (error) {
    await Wallet.updateOne(
      { user: user._id },
      { $inc: { balance: amount } }
    );

    tx.status = "FAILED";
    await tx.save();

    throw error;
  }
});
