import crypto from "crypto";
import bip39 from "bip39";
import hdkey from "hdkey";
import TronWeb from "tronweb";
// Encrypt the memomonic ok 
const algorithm = "aes-256-cbc";
const encryptionSecret = process.env.MENEMONIC_ENCRYPTION_KEY || "";

if (!encryptionSecret) {
  throw new Error("MENEMONIC_ENCRYPTION_KEY is missing");
}

const key = crypto.createHash("sha256").update(encryptionSecret).digest();

export const encrypt = (text) => {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
};

// Decrypt the memomonic
export const decrypt = (encryptedText) => {
  const [ivHex, encrypted] = encryptedText.split(":");

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivHex, "hex")
  );

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

// utils/tronKey.util.js
export const derivePrivateKeyFromMnemonic = (mnemonic, index = 0) => {
  try {
    // 🟢 Step 1: mnemonic → seed
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // 🟢 Step 2: seed → HD wallet
    const root = hdkey.fromMasterSeed(seed);

    // 🟢 Step 3: TRON derivation path
    const path = `m/44'/195'/0'/0/${index}`;

    const child = root.derive(path);

    // 🟢 Step 4: private key
    const privateKey = child.privateKey.toString("hex");

    return privateKey;

  } catch (error) {
    console.error("Private key derivation failed:", error);
    throw new Error("Failed to derive private key");
  }
};
