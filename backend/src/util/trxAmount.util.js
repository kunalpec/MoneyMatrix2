import { ApiError } from "./ApiError.util.js";

// ======== TRX Constants (1) ========
export const SUN_PER_TRX = 1_000_000;

// ======== Assert Safe Integer (2) ========
const assertSafeInteger = (value, label) => {
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(400, `${label} must be a safe integer`);
  }

  return value;
};

// ======== Convert TRX To SUN (3) ========
export const trxToSun = (value, label = "Amount") => {
  const amount =
    typeof value === "string" ? Number(value.trim()) : Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, `${label} must be a valid positive number`);
  }

  return assertSafeInteger(
    Math.round(amount * SUN_PER_TRX),
    `${label} in SUN`
  );
};

// ======== Convert SUN To TRX (4) ========
export const sunToTrx = (value, label = "Amount") => {
  const sun = assertSafeInteger(Number(value), `${label} in SUN`);

  if (sun < 0) {
    throw new ApiError(400, `${label} in SUN cannot be negative`);
  }

  return sun / SUN_PER_TRX;
};

// ======== Normalize SUN Amount (5) ========
export const normalizeSunAmount = (value, label = "Amount") => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new ApiError(400, `${label} must be a valid non-negative number`);
  }

  return assertSafeInteger(Math.trunc(numeric), `${label}`);
};

// ======== Build Amount Fields From SUN (6) ========
export const buildAmountFieldsFromSun = (value) => {
  const amountSun = normalizeSunAmount(value, "Amount in SUN");

  return {
    amountSun,
    amount: sunToTrx(amountSun, "Amount"),
  };
};

// ======== Build Balance Increment From SUN (7) ========
export const buildBalanceIncrementFromSun = (value) => {
  const amountSun = Number(value);

  if (!Number.isSafeInteger(amountSun)) {
    throw new ApiError(400, "Balance increment must be a safe integer");
  }

  return {
    balanceSun: amountSun,
    balance: amountSun / SUN_PER_TRX,
  };
};

// ======== Build Locked Balance Increment From SUN (8) ========
export const buildLockedBalanceIncrementFromSun = (value) => {
  const amountSun = Number(value);

  if (!Number.isSafeInteger(amountSun)) {
    throw new ApiError(400, "Locked balance increment must be a safe integer");
  }

  return {
    lockedBalanceSun: amountSun,
    lockedBalance: amountSun / SUN_PER_TRX,
  };
};
