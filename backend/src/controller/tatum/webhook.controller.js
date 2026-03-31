// controllers/webhook.controller.js

import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { sweepToAdminWallet } from "./ramp.controller.js";

const verifyWebhookSecret = (req, secret) => {
  if (!secret) return;

  const headerSecret =
    req.headers["x-webhook-secret"] ||
    req.headers["x-tatum-webhook-secret"] ||
    req.headers["x-transak-signature"] ||
    req.headers.authorization;

  if (headerSecret !== secret) {
    throw new ApiError(401, "Invalid webhook secret");
  }
};

/**
 * 🟢 DEPOSIT WEBHOOK (Tatum → Your App)
 */
export const tronWebhook = AsyncHandler(async (req, res) => {
  verifyWebhookSecret(req, process.env.TATUM_WEBHOOK_SECRET);

  const { address, amount, txId } = req.body;

  if (!address || !amount || !txId) {
    throw new ApiError(400, "Invalid webhook payload");
  }

  // 🔴 prevent duplicate
  const existing = await Transaction.findOne({
    txId,
    type: "DEPOSIT",
  });

  if (existing) {
    return res.status(200).json(
      new ApiResponse(200, null, "Deposit already processed")
    );
  }

  const wallet = await Wallet.findOne({ address });

  if (!wallet) {
    return res.status(200).json(
      new ApiResponse(200, null, "Wallet not found (ignored)")
    );
  }

  // 🟢 create deposit transaction
  const depositTx = await Transaction.create({
    userId: wallet.user,
    type: "DEPOSIT",
    amount,
    txId,
    status: "PENDING",
    toAddress: address,
  });

  try {
    // 🟢 credit user wallet
    await Wallet.updateOne(
      { user: wallet.user },
      { $inc: { balance: amount } }
    );

    depositTx.status = "SUCCESS";
    await depositTx.save();

    // 🔴 IMPORTANT: do not sweep admin wallet
    if (!wallet.isAdmin) {
      await sweepToAdminWallet({
        body: {
          userAddress: address,
          amount,
          txId: `${txId}_SWEEP`,
        },
      });
    }

    return res.status(200).json(
      new ApiResponse(200, { txId }, "Deposit processed successfully")
    );

  } catch (error) {
    console.error("Deposit error:", error);

    depositTx.status = "FAILED";
    await depositTx.save();

    throw new ApiError(500, "Deposit processing failed");
  }
});


/**
 * 🟢 WITHDRAW WEBHOOK (Tatum → Your App)
 */
export const tronWithdrawWebhook = AsyncHandler(async (req, res) => {
  verifyWebhookSecret(req, process.env.TATUM_WEBHOOK_SECRET);

  const { txId } = req.body;

  if (!txId) {
    throw new ApiError(400, "Invalid webhook payload");
  }

  const tx = await Transaction.findOne({ txId });

  if (!tx) {
    return res.status(200).json(
      new ApiResponse(200, null, "Transaction not found")
    );
  }

  if (tx.status === "SUCCESS") {
    return res.status(200).json(
      new ApiResponse(200, null, "Already processed")
    );
  }

  if (tx.type !== "WITHDRAW") {
    return res.status(200).json(
      new ApiResponse(200, null, "Not a withdraw transaction")
    );
  }

  // 🟢 mark success ONLY here
  tx.status = "SUCCESS";
  tx.confirmedAt = new Date();
  await tx.save();

  return res.status(200).json(
    new ApiResponse(200, { txId }, "Withdraw confirmed")
  );
});


/**
 * 🟢 OFF-RAMP WEBHOOK (Transak → Your App)
 */
export const transakWebhook = AsyncHandler(async (req, res) => {
  verifyWebhookSecret(req, process.env.TRANSAK_WEBHOOK_SECRET);

  const { eventType, data } = req.body;

  if (!eventType || !data) {
    throw new ApiError(400, "Invalid webhook payload");
  }

  const orderId = data.partnerOrderId || data.id;

  if (!orderId) {
    throw new ApiError(400, "Missing order ID");
  }

  const tx = await Transaction.findOne({ externalId: orderId });

  if (!tx) {
    return res.status(200).json(
      new ApiResponse(200, null, "Transaction not found")
    );
  }

  if (tx.status === "SUCCESS") {
    return res.status(200).json(
      new ApiResponse(200, null, "Already processed")
    );
  }

  switch (eventType) {
    case "ORDER_COMPLETED":
      tx.status = "SUCCESS";
      tx.completedAt = new Date();
      break;

    case "ORDER_FAILED":
    case "ORDER_CANCELLED":
      tx.status = "FAILED";

      // 🔁 refund user balance
      if (tx.userId) {
        await Wallet.updateOne(
          { user: tx.userId },
          { $inc: { balance: tx.amount } }
        );
      }
      break;

    default:
      return res.status(200).json(
        new ApiResponse(200, null, "Event ignored")
      );
  }

  await tx.save();

  return res.status(200).json(
    new ApiResponse(200, { orderId }, "Webhook processed")
  );
});
