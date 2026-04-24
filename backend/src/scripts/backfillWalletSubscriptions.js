import dotenv from "dotenv";
import mongoose from "mongoose";
import { Wallet } from "../model/wallet.model.js";
import { createDepositWebhookSubscription } from "../service/tatumSubscription.service.js";
import { logger } from "../util/logger.util.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const wallets = await Wallet.find({
    address: { $exists: true, $type: "string" },
    $or: [
      { depositSubscriptionId: null },
      { depositSubscriptionId: { $exists: false } },
    ],
  }).sort({ createdAt: 1 });

  let updatedCount = 0;

  for (const wallet of wallets) {
    const subscriptionId = await createDepositWebhookSubscription(wallet.address);

    await Wallet.updateOne(
      { _id: wallet._id },
      { $set: { depositSubscriptionId: subscriptionId } }
    );

    updatedCount += 1;

    logger.info("wallet.subscription.backfilled", {
      walletId: wallet._id.toString(),
      address: wallet.address,
      subscriptionId,
    });
  }

  console.log(
    `Wallet subscription backfill complete. Updated ${updatedCount} wallet(s).`
  );
};

run()
  .catch((error) => {
    console.error("Wallet subscription backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
