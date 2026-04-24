import axios from "axios";
import crypto from "crypto";
import { ApiError } from "../../util/ApiError.util.js";

// ======== Get Transak Refresh Token URL ========
const getTransakRefreshTokenUrl = () => {
  const isDev = process.env.NODE_ENV === "development";

  return isDev
    ? "https://api-stg.transak.com/partners/api/v2/refresh-token"
    : "https://api.transak.com/partners/api/v2/refresh-token";
};

// ======== Get Webhook Secret ========
const getTransakWebhookSecret = () => {
  const secret = process.env.TRANSAK_WEBHOOK_SECRET;

  if (!secret) {
    throw new ApiError(500, "TRANSAK_WEBHOOK_SECRET missing in .env");
  }

  return secret;
};

// ======== Stable JSON stringify (IMPORTANT for consistency) ========
const stableStringify = (obj) => {
  if (!obj || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {})
  );
};

// ======== Sign Transak Payload (FIXED) ========
const signTransakPayload = (payload, secret = getTransakWebhookSecret()) => {
  // Always ensure string
  const data =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  return crypto
    .createHmac("sha256", secret)
    .update(data, "utf8") // 🔥 important
    .digest("hex")
    .toLowerCase();
};

// ======== Generate Signature Candidates (FIXED) ========
const getTransakSignatureCandidates = ({
  body = {},
  rawBody,
  secret = getTransakWebhookSecret(),
} = {}) => {
  // RAW payload (exact webhook body)
  const rawPayload =
  typeof rawBody === "string" && rawBody.length > 0
    ? JSON.stringify(JSON.parse(rawBody)) // 🔥 normalize
    : JSON.stringify(body || {});

  // NORMALIZED payload (sorted keys)
  const normalizedPayload = stableStringify(body || {});

  return {
    rawPayload,
    normalizedPayload,

    // Generate signatures
    rawHash: signTransakPayload(rawPayload, secret),
    normalizedHash: signTransakPayload(normalizedPayload, secret),
  };
};

// ======== Generate Transak Access Token ========
const generateTransakAccessToken = async () => {
  if (!process.env.TRANSAK_API_KEY || !process.env.TRANSAK_API_SECRET) {
    throw new ApiError(
      500,
      "TRANSAK_API_KEY or TRANSAK_API_SECRET missing"
    );
  }

  try {
    const response = await axios.post(
      getTransakRefreshTokenUrl(),
      {
        apiKey: process.env.TRANSAK_API_KEY,
      },
      {
        headers: {
          "api-secret": process.env.TRANSAK_API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data?.data || {};
  } catch (error) {
    const statusCode = error?.response?.status || 500;
    const transakMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to fetch Transak token";

    const hint =
      statusCode === 401
        ? " Verify that TRANSAK_API_KEY and TRANSAK_API_SECRET belong to the same Production environment."
        : "";

    throw new ApiError(
      statusCode,
      `${transakMessage}${hint}`
    );
  }
};

// ======== API: Get Access Token ========
const getTransakAccessToken = async (req, res) => {
  const data = await generateTransakAccessToken();
  return res.json(data);
};

// ======== API: Generate Webhook Signature (FIXED) ========
const getTransakWebhookSignature = async (req, res) => {
  const payload = req.body?.payload ?? req.body ?? {};

  // Use RAW body if available (important)
  const rawBody =
    typeof req.body?.rawBody === "string"
      ? req.body.rawBody
      : req.rawBody;

  const { rawPayload, normalizedPayload, rawHash, normalizedHash } =
    getTransakSignatureCandidates({
      body: payload,
      rawBody,
    });

  return res.json({
    signature: rawHash, // 🔥 this is what Transak uses
    rawSignature: rawHash,
    normalizedSignature: normalizedHash,

    debug: {
      rawPayload,
      normalizedPayload,
    },
  });
};

export {
  generateTransakAccessToken,
  getTransakAccessToken,
  getTransakWebhookSignature,
  getTransakSignatureCandidates,
  getTransakWebhookSecret,
  signTransakPayload,
};
