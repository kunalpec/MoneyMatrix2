import { ApiError } from "./ApiError.util.js";
import {
  decrypt,
  derivePrivateKeyFromMnemonic,
} from "./EncryptDecrypt.util.js";

export const resolveTronTransactionSigner = (
  wallet,
  { walletLabel = "wallet", envSignatureId = null } = {}
) => {
  const signatureId = String(
    wallet?.signatureId || envSignatureId || ""
  ).trim();

  if (signatureId) {
    return {
      signatureId,
      signerProvider: wallet?.signerProvider || "TATUM_KMS",
    };
  }

  if (!wallet?.mnemonic) {
    throw new ApiError(
      500,
      `${walletLabel} is missing a Tatum KMS signatureId or encrypted mnemonic`
    );
  }

  const mnemonic = decrypt(wallet.mnemonic);

  return {
    fromPrivateKey: derivePrivateKeyFromMnemonic(mnemonic, wallet.index || 0),
    signerProvider: "MNEMONIC",
  };
};
