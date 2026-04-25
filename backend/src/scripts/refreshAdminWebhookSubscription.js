import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../db/db.js";
import { Wallet } from "../model/wallet.model.js";
import { replaceDepositWebhookSubscription } from "../service/tatumSubscription.service.js";

try {
  await connectDB();

  const adminWallet = await Wallet.findOne({ isAdmin: true });

  if (!adminWallet?.address) {
    throw new Error("Admin wallet address not found");
  }

  const configuredAddress = String(
    process.env.TATUM_TRON_ADMIN_ADDRESS || ""
  ).trim();

  if (configuredAddress && configuredAddress !== adminWallet.address) {
    throw new Error(
      `Admin address mismatch. .env has ${configuredAddress} but DB admin wallet is ${adminWallet.address}`
    );
  }

  const previousSubscriptionId = adminWallet.depositSubscriptionId || null;
  const subscriptionId = await replaceDepositWebhookSubscription({
    address: adminWallet.address,
    existingSubscriptionId: previousSubscriptionId,
  });

  adminWallet.depositSubscriptionId = subscriptionId;
  await adminWallet.save();

  console.log(
    JSON.stringify(
      {
        success: true,
        address: adminWallet.address,
        previousSubscriptionId,
        subscriptionId,
        webhookUrl: `${String(
          process.env.PUBLIC_WEBHOOK_BASE_URL ||
            process.env.BACKEND_PUBLIC_URL ||
            ""
        ).replace(/\/+$/, "")}/api/v1/webhook/tatum/address`,
        subscriptionType: "INCOMING_NATIVE_TX",
        chain: "TRON",
      },
      null,
      2
    )
  );
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
