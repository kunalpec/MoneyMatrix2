import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../db/db.js";
import { Wallet } from "../model/wallet.model.js";

const signatureId = String(
  process.env.TATUM_TRON_ADMIN_SIGNATURE_ID || ""
).trim();
const signerRef = String(process.env.TATUM_TRON_ADMIN_SIGNER_REF || "").trim();

if (!signatureId) {
  throw new Error("TATUM_TRON_ADMIN_SIGNATURE_ID is required");
}

try {
  await connectDB();

  const adminWallet = await Wallet.findOne({ isAdmin: true });

  if (!adminWallet) {
    throw new Error("Admin wallet not found");
  }

  adminWallet.signatureId = signatureId;
  adminWallet.signerProvider = "TATUM_KMS";
  adminWallet.signerRef = signerRef || null;
  await adminWallet.save();

  console.log(
    JSON.stringify(
      {
        success: true,
        walletId: adminWallet._id.toString(),
        address: adminWallet.address,
        signatureId: adminWallet.signatureId,
        signerProvider: adminWallet.signerProvider,
        signerRef: adminWallet.signerRef,
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
