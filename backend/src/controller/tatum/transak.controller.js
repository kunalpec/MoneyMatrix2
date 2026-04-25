import axios from "axios";
import jwt from "jsonwebtoken";
import { ApiError } from "../../util/ApiError.util.js";
import { verifySha256HmacSignature } from "../../middleware/rawBody.middleware.js";

let cachedTransakAccessToken = String(
  process.env.TRANSAK_ACCESS_TOKEN || ""
).trim();
let cachedTransakAccessTokenExpiresAt = 0;
let transakAccessTokenRefreshPromise = null;

const normalizeEnvValue = (value) => String(value || "").trim();

const decodeJwtExpiry = (token) => {
  const decoded = jwt.decode(token);
  return decoded?.exp ? Number(decoded.exp) * 1000 : 0;
};

const cacheTransakAccessToken = (token, expiresAt = null) => {
  const normalizedToken = normalizeEnvValue(token);

  if (!normalizedToken) {
    throw new ApiError(500, "Transak access token missing");
  }

  cachedTransakAccessToken = normalizedToken;
  cachedTransakAccessTokenExpiresAt = expiresAt
    ? Number(expiresAt) * 1000
    : decodeJwtExpiry(normalizedToken);
  process.env.TRANSAK_ACCESS_TOKEN = normalizedToken;

  return normalizedToken;
};

const getCachedTransakAccessToken = () => {
  if (!cachedTransakAccessToken && process.env.TRANSAK_ACCESS_TOKEN) {
    cacheTransakAccessToken(process.env.TRANSAK_ACCESS_TOKEN);
  }

  return cachedTransakAccessToken;
};

const isTransakAccessTokenFresh = () =>
  Boolean(getCachedTransakAccessToken()) &&
  cachedTransakAccessTokenExpiresAt > Date.now() + 60_000;

// ======== Get Transak Refresh Token URL ========
const getTransakRefreshTokenUrl = () => {
  const isDev = process.env.NODE_ENV === "development";

  return isDev
    ? "https://api-stg.transak.com/partners/api/v2/refresh-token"
    : "https://api.transak.com/partners/api/v2/refresh-token";
};

const normalizeTransakWebhookPayload = (decodedPayload = {}, rawBody = {}) => {
  const webhookData = decodedPayload?.webhookData || {};
  const eventType =
    decodedPayload?.eventId ||
    decodedPayload?.eventID ||
    rawBody?.eventID ||
    rawBody?.eventId ||
    webhookData?.status ||
    rawBody?.status ||
    null;

  return {
    eventType: String(eventType || "").trim().toUpperCase(),
    data: {
      ...webhookData,
      partnerOrderId:
        webhookData?.partnerOrderId ||
        webhookData?.partner_order_id ||
        decodedPayload?.partnerOrderId ||
        decodedPayload?.partner_order_id ||
        rawBody?.partnerOrderId ||
        rawBody?.partner_order_id,
      orderId:
        webhookData?.orderId ||
        webhookData?.orderID ||
        webhookData?.order_id ||
        webhookData?.id ||
        decodedPayload?.orderId ||
        decodedPayload?.orderID ||
        decodedPayload?.order_id ||
        rawBody?.orderId ||
        rawBody?.orderID ||
        rawBody?.order_id,
      providerWebhookId:
        decodedPayload?.id || rawBody?.id || rawBody?.webhookId || null,
      eventId:
        decodedPayload?.eventId ||
        decodedPayload?.eventID ||
        rawBody?.eventId ||
        rawBody?.eventID ||
        null,
      eventID:
        decodedPayload?.eventID ||
        decodedPayload?.eventId ||
        rawBody?.eventID ||
        rawBody?.eventId ||
        null,
    },
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
        ? " Verify that TRANSAK_API_KEY and TRANSAK_API_SECRET belong to the same environment."
        : "";

    throw new ApiError(statusCode, `${transakMessage}${hint}`);
  }
};

const refreshTransakAccessToken = async () => {
  if (!transakAccessTokenRefreshPromise) {
    transakAccessTokenRefreshPromise = (async () => {
      const data = await generateTransakAccessToken();
      return {
        accessToken: cacheTransakAccessToken(data?.accessToken, data?.expiresAt),
        expiresAt: data?.expiresAt || null,
      };
    })().finally(() => {
      transakAccessTokenRefreshPromise = null;
    });
  }

  return transakAccessTokenRefreshPromise;
};

const getTransakVerificationAccessToken = async () => {
  if (isTransakAccessTokenFresh()) {
    return getCachedTransakAccessToken();
  }

  if (getCachedTransakAccessToken() && cachedTransakAccessTokenExpiresAt === 0) {
    return getCachedTransakAccessToken();
  }

  const refreshed = await refreshTransakAccessToken();
  return refreshed.accessToken;
};

const verifyTransakWebhookJwt = async (signedJwt, { allowRefresh = true } = {}) => {
  const verificationToken = await getTransakVerificationAccessToken();

  try {
    return jwt.verify(signedJwt, verificationToken);
  } catch (error) {
    const shouldRetryWithRefresh =
      allowRefresh &&
      ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(
        error?.name
      );

    if (!shouldRetryWithRefresh) {
      throw new ApiError(401, "Invalid Transak webhook token");
    }

    const refreshed = await refreshTransakAccessToken();

    try {
      return jwt.verify(signedJwt, refreshed.accessToken);
    } catch {
      throw new ApiError(401, "Invalid Transak webhook token");
    }
  }
};

const verifyTransakWebhookHmac = (req) => {
  const secret = normalizeEnvValue(process.env.TRANSAK_WEBHOOK_SECRET);
  const signatureHeader =
    req.headers["transak-signature"] || req.headers["x-transak-signature"];

  if (!secret || !signatureHeader) {
    return {
      checked: false,
      valid: true,
    };
  }

  const payload =
    typeof req.rawBody === "string" && req.rawBody.length > 0
      ? req.rawBody
      : JSON.stringify(req.body || {});

  return {
    checked: true,
    valid: verifySha256HmacSignature({
      payload,
      providedSignature: Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader,
      secret,
    }),
  };
};

const getVerifiedTransakWebhookPayload = async (req) => {
  const hmacVerification = verifyTransakWebhookHmac(req);

  if (!hmacVerification.valid) {
    throw new ApiError(401, "Invalid Transak webhook signature");
  }

  const signedJwt = normalizeEnvValue(req.body?.data);

  if (!signedJwt) {
    throw new ApiError(401, "Missing Transak webhook JWT");
  }

  const decodedPayload = await verifyTransakWebhookJwt(signedJwt);

  return {
    ...normalizeTransakWebhookPayload(decodedPayload, req.body),
    decodedPayload,
    verificationMethod: hmacVerification.checked ? "JWT+HMAC" : "JWT",
  };
};

// ======== API: Get Access Token ========
const getTransakAccessToken = async (req, res) => {
  const accessToken = await getTransakVerificationAccessToken();

  return res.json({
    accessToken,
    expiresAt: cachedTransakAccessTokenExpiresAt
      ? Math.floor(cachedTransakAccessTokenExpiresAt / 1000)
      : null,
  });
};

// ======== API: Decode Webhook JWT ========
const getTransakWebhookSignature = async (req, res) => {
  const signedJwt = normalizeEnvValue(req.body?.data);

  if (!signedJwt) {
    throw new ApiError(400, "Webhook data JWT is required");
  }

  const decodedPayload = await verifyTransakWebhookJwt(signedJwt);

  return res.json({
    verification: "JWT",
    decodedPayload,
    normalizedPayload: normalizeTransakWebhookPayload(decodedPayload, req.body),
  });
};

export {
  generateTransakAccessToken,
  getTransakAccessToken,
  getTransakWebhookSignature,
  getVerifiedTransakWebhookPayload,
};
