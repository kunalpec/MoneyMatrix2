import { Wallet } from "../../model/wallet.model.js";
import { ApiError } from "../../util/ApiError.util.js";
import { trxToSun } from "../../util/trxAmount.util.js";

export const ensureWalletAccountingFields = async (walletOrId, session = null) => {

  const wallet =
    typeof walletOrId === "object" && walletOrId?._id
      ? walletOrId
      : await Wallet.findById(walletOrId).session(session);

  if (!wallet) {
    throw new ApiError(404, "Wallet not found");
  }

  const update = {};

  if (!Number.isSafeInteger(wallet.trxBalanceSun)) {
    update.trxBalanceSun = trxToSun(wallet.trxBalance || 0, "Wallet balance");
  }

  if (!Number.isSafeInteger(wallet.trxLockedBalanceSun)) {
    update.trxLockedBalanceSun = trxToSun(
      wallet.trxLockedBalance || 0,
      "Locked wallet balance"
    );
  }

  if (Object.keys(update).length === 0) {
    return wallet;
  }

  return Wallet.findByIdAndUpdate(
    wallet._id,
    { $set: update },
    { returnDocument: "after", session }
  );
};

export const getWalletBalanceSun = (wallet) => {
  if (Number.isSafeInteger(wallet?.trxBalanceSun)) {
    return wallet.trxBalanceSun;
  }

  return trxToSun(wallet?.trxBalance || 0, "Wallet balance");
};
