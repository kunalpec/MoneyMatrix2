import crypto from "crypto";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { sweepToAdminWallet } from "./ramp.controller.js";


// ================= VERIFY TRANSAK SIGNATURE =================
const verifyTransakSignature = (req) => {
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


// ================= VERIFY TATUM =================
const verifyTatum = (req) => {
  const secret = process.env.TATUM_WEBHOOK_SECRET;
  if (!secret) return;

  const header = req.headers["x-tatum-webhook-secret"];
  if (header !== secret) {
    throw new ApiError(401, "Invalid Tatum webhook");
  }
};


// ================= PARSE TRANSAK =================
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


// ================= TRANSAK WEBHOOK =================
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

      // ================= SUCCESS =================
      case "ORDER_COMPLETED":
      case "COMPLETED":
      case "SUCCESS": {
        if (tx.status === "SUCCESS") {
          return res.json(new ApiResponse(200, { orderId }, "Already processed"));
        }

        // For on-ramp deposits, the on-chain Tatum webhook is the source of truth.
        // Transak only confirms the fiat order completed successfully.
        if (tx.type === "DEPOSIT") {
          const amount = getAmount(data);
          if (amount > 0) {
            tx.amount = amount;
          }

          tx.status = "PROCESSING";
          tx.processed = false;
          await tx.save();

          return res.json(
            new ApiResponse(200, { orderId }, "Deposit order confirmed, awaiting blockchain settlement")
          );
        }

        // Off-ramp is completed once Transak confirms the bank payout.
        if (tx.type === "WITHDRAW") {
          tx.status = "SUCCESS";
          tx.processed = true;
          tx.completedAt = new Date();
          await tx.save();

          return res.json(
            new ApiResponse(200, { orderId }, "Withdraw completed (bank success)")
          );
        }
      }

      // ================= FAILED =================
      case "FAILED":
      case "ORDER_FAILED":
      case "CANCELLED": {
        if (tx.status === "FAILED") {
          return res.json(new ApiResponse(200, { orderId }, "Already processed"));
        }

        tx.status = "FAILED";
        tx.processed = true;

        // Refund only off-ramp withdrawals. Deposits were never debited.
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
        return res.json(
          new ApiResponse(200, null, "Ignored")
        );
    }

  } catch (err) {
    console.error("Transak webhook error:", err);

    tx.status = "FAILED";
    await tx.save();

    throw err;
  }
});


// ================= TATUM DEPOSIT =================
export const tronWebhook = AsyncHandler(async (req, res) => {

  verifyTatum(req);

  const { address, amount, txId } = req.body;

  if (!address || !amount || !txId) {
    throw new ApiError(400, "Invalid payload");
  }

  // 🔒 prevent duplicate
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

  const tx = await Transaction.create({
    userId: wallet.user,
    type: "DEPOSIT",
    amount,
    txId,
    toAddress: address,
    status: "SUCCESS",
  });

  // 💰 credit
  await Wallet.updateOne(
    { user: wallet.user },
    { $inc: { balance: amount } }
  );

  // 🧹 sweep
  if (!wallet.isAdmin) {
    await sweepToAdminWallet({
      userAddress: address,
      amount,
      txId: txId + "_SWEEP",
    });
  }

  return res.json(new ApiResponse(200, { txId }, "Deposit done"));
});


// ================= TATUM WITHDRAW =================
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

  // 🔁 ONLY PROCESSING (NOT SUCCESS)
  tx.status = "PROCESSING";
  tx.confirmedAt = new Date();
  await tx.save();

  return res.json(
    new ApiResponse(200, { txId }, "Crypto sent, waiting bank transfer")
  );
});
