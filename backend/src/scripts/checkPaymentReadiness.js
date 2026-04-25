import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../db/db.js";
import { Wallet } from "../model/wallet.model.js";
import { tatumClient } from "../controller/tatum/client.controller.js";
import {
  assertRuntimeConfiguration,
  getRuntimeWarnings,
} from "../config/runtimeValidation.js";
import { getConfiguredTronTokenAddress } from "../util/tronTransfer.util.js";

const normalizeTokenBalance = (accountData, tokenAddress) => {
  const normalizedTokenAddress = String(tokenAddress || "").trim();

  if (!normalizedTokenAddress) {
    return null;
  }

  const entry = Array.isArray(accountData?.trc20)
    ? accountData.trc20.find(
        (item) =>
          Object.keys(item || {})[0]?.toLowerCase() ===
          normalizedTokenAddress.toLowerCase()
      )
    : null;

  if (!entry) {
    return "0";
  }

  return String(entry[Object.keys(entry)[0]] || "0");
};

try {
  let runtimeValid = true;
  let runtimeError = null;

  try {
    assertRuntimeConfiguration();
  } catch (error) {
    runtimeValid = false;
    runtimeError = error.message;
  }

  await connectDB();

  const adminWallet = await Wallet.findOne({ isAdmin: true }).lean();
  const configuredAdminAddress = String(
    process.env.TATUM_TRON_ADMIN_ADDRESS || ""
  ).trim();

  let accountLookup = null;
  let chainLookupError = null;

  if (adminWallet?.address) {
    try {
      const response = await tatumClient.get(`/tron/account/${adminWallet.address}`);
      const tokenAddress = getConfiguredTronTokenAddress();
      const nativeBalanceSun = Number(response?.data?.balance ?? 0);

      accountLookup = {
        address: adminWallet.address,
        nativeBalanceSun,
        nativeBalanceTrx: nativeBalanceSun / 1_000_000,
        tokenAddress: tokenAddress || null,
        tokenBalanceRaw: normalizeTokenBalance(response?.data, tokenAddress),
      };
    } catch (error) {
      chainLookupError =
        error?.response?.data?.message || error?.message || "Unknown lookup failure";
    }
  }

  const report = {
    ok:
      runtimeValid &&
      Boolean(adminWallet) &&
      (!configuredAdminAddress || configuredAdminAddress === adminWallet?.address),
    runtimeValid,
    runtimeError,
    runtimeWarnings: getRuntimeWarnings(),
    adminWallet: adminWallet
      ? {
          id: adminWallet._id.toString(),
          user: adminWallet.user?.toString?.() || String(adminWallet.user),
          address: adminWallet.address,
          signatureId: adminWallet.signatureId || null,
          signerProvider: adminWallet.signerProvider || null,
          configuredAddressMatches:
            !configuredAdminAddress || configuredAdminAddress === adminWallet.address,
          dbTrxBalanceSun: adminWallet.trxBalanceSun || 0,
          dbTrxBalanceTrx: (adminWallet.trxBalanceSun || 0) / 1_000_000,
        }
      : null,
    configuredAdminAddress: configuredAdminAddress || null,
    chainAccount: accountLookup,
    chainLookupError,
    checks: {
      adminWalletExists: Boolean(adminWallet),
      adminWalletAddressMatchesEnv:
        !configuredAdminAddress || configuredAdminAddress === adminWallet?.address,
      adminWalletHasSigner: Boolean(
        adminWallet?.signatureId || adminWallet?.mnemonic
      ),
      runtimeSafeForProduction: runtimeValid,
      adminHasPositiveDbBalance: Boolean((adminWallet?.trxBalanceSun || 0) > 0),
      adminHasPositiveChainBalance: Boolean(
        (accountLookup?.nativeBalanceSun || 0) > 0
      ),
    },
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
