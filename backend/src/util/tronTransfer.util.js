import { tatumClient } from "../controller/tatum/client.controller.js";
import { ApiError } from "./ApiError.util.js";

const getConfiguredTrc20TokenAddress = () =>
  String(
    process.env.TATUM_TRON_TRC20_TOKEN_ADDRESS ||
      process.env.TRON_TRC20_TOKEN_ADDRESS ||
      process.env.TRC20_TOKEN_ADDRESS ||
      ""
  ).trim();

export const getConfiguredTronTransferMode = ({
  tokenAddress = null,
} = {}) => {
  const explicitMode = String(
    process.env.TATUM_TRON_TRANSFER_MODE || process.env.TRON_TRANSFER_MODE || ""
  )
    .trim()
    .toUpperCase();

  if (explicitMode === "TRC20") {
    return "TRC20";
  }

  if (explicitMode === "TRX") {
    return "TRX";
  }

  if (String(tokenAddress || "").trim()) {
    return "TRC20";
  }

  return "TRX";
};

export const getConfiguredTronTransferCurrency = ({
  tokenAddress = null,
} = {}) =>
  getConfiguredTronTransferMode({ tokenAddress }) === "TRC20" ? "TRC20" : "TRX";

export const getConfiguredTronTokenAddress = ({ tokenAddress = null } = {}) =>
  String(tokenAddress || getConfiguredTrc20TokenAddress()).trim() || null;

export const submitTatumTronTransfer = async ({
  toAddress,
  amount,
  signer,
  fromAddress = null,
  tokenAddress = null,
}) => {
  const transferMode = getConfiguredTronTransferMode({ tokenAddress });

  if (transferMode === "TRC20") {
    const resolvedTokenAddress = getConfiguredTronTokenAddress({ tokenAddress });

    if (!resolvedTokenAddress) {
      throw new ApiError(
        500,
        "TRC20 transfer requested but token address is missing"
      );
    }

    if (!fromAddress) {
      throw new ApiError(
        500,
        "TRC20 transfer requires the sender wallet address"
      );
    }

    return tatumClient.post("/tron/trc20/transaction", {
      to: toAddress,
      tokenAddress: resolvedTokenAddress,
      amount,
      fromAddress,
      ...(signer.signatureId
        ? { signatureId: signer.signatureId }
        : { fromPrivateKey: signer.fromPrivateKey }),
    });
  }

  return tatumClient.post("/tron/transaction", {
    to: toAddress,
    amount,
    ...(signer.signatureId
      ? { signatureId: signer.signatureId }
      : { fromPrivateKey: signer.fromPrivateKey }),
  });
};
