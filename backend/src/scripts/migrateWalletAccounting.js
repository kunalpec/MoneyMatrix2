import dotenv from "dotenv";
import mongoose from "mongoose";
import { Wallet } from "../model/wallet.model.js";

dotenv.config();

const SUN_PER_TRX = 1_000_000;

const toSun = (value) => Math.round(Number(value || 0) * SUN_PER_TRX);

const resolveSunValue = (doc, integerKeys, decimalKeys) => {
  for (const key of integerKeys) {
    if (Number.isSafeInteger(doc?.[key]) && doc[key] >= 0) {
      return doc[key];
    }
  }

  for (const key of decimalKeys) {
    if (Number.isFinite(Number(doc?.[key])) && Number(doc[key]) >= 0) {
      return toSun(doc[key]);
    }
  }

  return 0;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const cursor = Wallet.collection.find(
    {},
    {
      projection: {
        trxBalanceSun: 1,
        trxLockedBalanceSun: 1,
        balanceSun: 1,
        lockedBalanceSun: 1,
        balance: 1,
        lockedBalance: 1,
      },
    }
  );

  const operations = [];
  let scanned = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const trxBalanceSun = resolveSunValue(
      doc,
      ["trxBalanceSun", "balanceSun"],
      ["trxBalance", "balance"]
    );
    const trxLockedBalanceSun = resolveSunValue(
      doc,
      ["trxLockedBalanceSun", "lockedBalanceSun"],
      ["trxLockedBalance", "lockedBalance"]
    );

    if (
      doc?.trxBalanceSun === trxBalanceSun &&
      doc?.trxLockedBalanceSun === trxLockedBalanceSun
    ) {
      continue;
    }

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            trxBalanceSun,
            trxLockedBalanceSun,
          },
          $unset: {
            balance: "",
            balanceSun: "",
            lockedBalance: "",
            lockedBalanceSun: "",
            trxBalance: "",
            trxLockedBalance: "",
            usdtBalance: "",
            usdtBalanceUnits: "",
            usdtLockedBalance: "",
            usdtLockedBalanceUnits: "",
          },
        },
      },
    });
  }

  if (operations.length > 0) {
    await Wallet.bulkWrite(operations);
  }

  console.log(
    `Wallet accounting migration complete. Scanned ${scanned} wallet(s), updated ${operations.length}.`
  );
};

run()
  .catch((error) => {
    console.error("Wallet accounting migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
