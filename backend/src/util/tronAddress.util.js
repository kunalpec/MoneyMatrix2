import TronWeb from "tronweb";
import { ApiError } from "./ApiError.util.js";

// ======== Validate Tron Address (1) ========
export const isValidTronAddress = (address) => {
  if (!address || typeof address !== "string") {
    return false;
  }

  try {
    return TronWeb.isAddress(address.trim());
  } catch {
    return false;
  }
};

// ======== Assert Valid Tron Address (2) ========
export const assertValidTronAddress = (address, label = "Tron address") => {
  if (!isValidTronAddress(address)) {
    throw new ApiError(400, `Invalid ${label}`);
  }

  return address.trim();
};
