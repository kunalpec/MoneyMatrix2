import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../db/db.js";
import { User } from "../model/user.model.js";
import { Wallet } from "../model/wallet.model.js";

const resolveAdminUserFilter = () => {
  const userId = String(process.env.ADMIN_WALLET_USER_ID || "").trim();
  const email = String(process.env.ADMIN_WALLET_USER_EMAIL || "")
    .trim()
    .toLowerCase();
  const phone = String(process.env.ADMIN_WALLET_USER_PHONE || "").trim();

  if (userId) {
    return { _id: userId };
  }

  if (email) {
    return { email };
  }

  if (phone) {
    return { phone };
  }

  throw new Error(
    "Set ADMIN_WALLET_USER_ID, ADMIN_WALLET_USER_EMAIL, or ADMIN_WALLET_USER_PHONE before running ensureAdminWallet"
  );
};

try {
  await connectDB();

  const adminUser = await User.findOne(resolveAdminUserFilter());

  if (!adminUser) {
    throw new Error("Admin user not found");
  }

  if (adminUser.role !== "admin") {
    throw new Error("Selected user is not an admin");
  }

  const wallet = await Wallet.findOne({ user: adminUser._id });

  if (!wallet) {
    throw new Error(
      "Admin user does not have a wallet yet. Create the wallet first, then rerun this script."
    );
  }

  const otherAdminWallet = await Wallet.findOne({
    isAdmin: true,
    _id: { $ne: wallet._id },
  });

  if (otherAdminWallet) {
    throw new Error(
      `Another admin wallet already exists at address ${otherAdminWallet.address}`
    );
  }

  wallet.isAdmin = true;
  wallet.signatureId = String(
    process.env.TATUM_TRON_ADMIN_SIGNATURE_ID || wallet.signatureId || ""
  ).trim() || null;
  wallet.signerProvider = wallet.signatureId ? "TATUM_KMS" : wallet.signerProvider;
  wallet.signerRef = String(
    process.env.TATUM_TRON_ADMIN_SIGNER_REF || wallet.signerRef || ""
  ).trim() || null;
  await wallet.save();

  console.log(
    JSON.stringify(
      {
        success: true,
        adminUserId: adminUser._id.toString(),
        walletId: wallet._id.toString(),
        address: wallet.address,
        isAdmin: wallet.isAdmin,
        signatureId: wallet.signatureId,
        signerProvider: wallet.signerProvider,
        signerRef: wallet.signerRef,
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
