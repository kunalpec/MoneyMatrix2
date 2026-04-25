import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { enableTatumWebhookHmac } from "../service/tatumSubscription.service.js";

try {
  await enableTatumWebhookHmac();

  console.log(
    JSON.stringify(
      {
        success: true,
        message: "Tatum webhook HMAC enabled for the current API key",
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
