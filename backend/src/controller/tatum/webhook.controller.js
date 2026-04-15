import crypto from "crypto";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { sweepToAdminWallet } from "./ramp.controller.js";

const verifyTransakSignature = (req) => {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  const signature = req.headers["x-transak-signature"];
  const secret = process.env.TRANSAK_WEBHOOK_SECRET;

  if (!signature || !secret) {
    throw new ApiError(401, "Missing Transak signature");
  }

  const hash = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== signature) {
    throw new ApiError(401, "Invalid Transak signature");
  }
};

const verifyTatum = (req) => {
  const secret = process.env.TATUM_WEBHOOK_SECRET;
  if (!secret) return;

  const header = req.headers["x-tatum-webhook-secret"];
  if (header !== secret) {
    throw new ApiError(401, "Invalid Tatum webhook");
  }
};

const getPayload = (body = {}) => {
  if (body?.eventType && body?.data) {
    return { eventType: body.eventType, data: body.data };
  }

  const webhookData = body?.data?.[0]?.webhookData || {};
  return {
    eventType: webhookData?.status,
    data: webhookData,
  };
};

const getAmount = (data = {}) => {
  return Number(
    data.cryptoAmount ||
      data.cryptoCurrencyAmount ||
      data.totalAmount ||
      0
  );
};

export const transakWebhook = AsyncHandler(async (req, res) => {
  verifyTransakSignature(req);

  const { eventType, data } = getPayload(req.body);
  const orderId = data.partnerOrderId || data.orderId || data.id;

  if (!orderId) {
    throw new ApiError(400, "Missing orderId");
  }

  const tx = await Transaction.findOne({ externalId: orderId });

  if (!tx) {
    return res.json(new ApiResponse(200, null, "Transaction not found"));
  }

  try {
    tx.metadata = data;

    switch (eventType) {
      case "ORDER_COMPLETED":
      case "COMPLETED":
      case "SUCCESS": {
        if (tx.processed) {
          return res.json(new ApiResponse(200, { orderId }, "Already processed"));
        }

        if (tx.type === "DEPOSIT") {
          const amount = getAmount(data);
          if (amount <= 0) {
            throw new ApiError(400, "Invalid deposit amount");
          }

          tx.amount = amount;
          tx.txId =
            data.transactionHash ||
            data.cryptoTransactionHash ||
            tx.txId;
          tx.status = "PROCESSING";
          tx.processed = false;
          await tx.save();

          return res.json(
            new ApiResponse(
              200,
              { orderId },
              "Deposit order confirmed, waiting for blockchain deposit"
            )
          );
        }

        if (tx.type === "WITHDRAW") {
          tx.status = "SUCCESS";
          tx.processed = true;
          tx.processedAt = new Date();
          tx.completedAt = new Date();
          await tx.save();

          return res.json(
            new ApiResponse(200, { orderId }, "Withdraw completed (bank success)")
          );
        }

        break;
      }

      case "FAILED":
      case "ORDER_FAILED":
      case "CANCELLED": {
        if (tx.status === "FAILED") {
          return res.json(new ApiResponse(200, { orderId }, "Already processed"));
        }

        tx.status = "FAILED";
        tx.processed = true;
        tx.processedAt = new Date();

        if (tx.type === "WITHDRAW" && tx.userId) {
          await Wallet.updateOne(
            { user: tx.userId },
            { $inc: { balance: tx.amount } }
          );
        }

        await tx.save();

        return res.json(
          new ApiResponse(200, { orderId }, "Transaction failed")
        );
      }

      default:
        await tx.save();
        return res.json(new ApiResponse(200, null, "Ignored"));
    }
  } catch (err) {
    console.error("Transak webhook error:", err);

    if (tx.type !== "DEPOSIT" || tx.status !== "SUCCESS") {
      tx.status = "FAILED";
      tx.processed = true;
      tx.processedAt = new Date();
    } else {
      tx.lastError = err.message;
    }

    await tx.save();

    throw err;
  }
});

export const tronWebhook = AsyncHandler(async (req, res) => {
  verifyTatum(req);

  const { address, amount, txId } = req.body;

  if (!address || !amount || !txId) {
    throw new ApiError(400, "Invalid payload");
  }

  const exists = await Transaction.findOne({
    txId,
    type: "DEPOSIT",
  });

  if (exists) {
    return res.json(new ApiResponse(200, null, "Already processed"));
  }

  const wallet = await Wallet.findOne({ address });
  if (!wallet) {
    return res.json(new ApiResponse(200, null, "Ignored"));
  }

  let tx = await Transaction.findOne({
    type: "DEPOSIT",
    toAddress: address,
    processed: false,
  }).sort({ createdAt: -1 });

  if (tx) {
    await Wallet.updateOne(
      { user: wallet.user },
      { $inc: { balance: Number(amount) } }
    );

    tx.amount = Number(amount);
    tx.txId = txId;
    tx.status = "SUCCESS";
    tx.processed = true;
    tx.processedAt = new Date();
    tx.confirmedAt = new Date();
    tx.completedAt = new Date();
    await tx.save();
  } else {
    tx = await Transaction.create({
      userId: wallet.user,
      type: "DEPOSIT",
      amount: Number(amount),
      txId,
      toAddress: address,
      status: "SUCCESS",
      processed: true,
      processedAt: new Date(),
      confirmedAt: new Date(),
      completedAt: new Date(),
    });

    await Wallet.updateOne(
      { user: wallet.user },
      { $inc: { balance: Number(amount) } }
    );
  }

  if (!wallet.isAdmin) {
    await sweepToAdminWallet({
      userAddress: address,
      amount: Number(amount),
      txId: txId + "_SWEEP",
    });
  }

  return res.json(new ApiResponse(200, { txId }, "Deposit done"));
});

export const tronWithdrawWebhook = AsyncHandler(async (req, res) => {
  verifyTatum(req);

  const { txId } = req.body;

  const tx = await Transaction.findOne({ txId });

  if (!tx) {
    return res.json(new ApiResponse(200, null, "Not found"));
  }

  if (tx.status === "SUCCESS") {
    return res.json(new ApiResponse(200, null, "Already done"));
  }

  if (tx.type !== "WITHDRAW") {
    return res.json(new ApiResponse(200, null, "Ignored"));
  }

  tx.status = "PROCESSING";
  tx.confirmedAt = new Date();
  await tx.save();

  return res.json(
    new ApiResponse(200, { txId }, "Crypto sent, waiting bank transfer")
  );
});
