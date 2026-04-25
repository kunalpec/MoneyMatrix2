import { ApiError } from "../util/ApiError.util.js";

const PRODUCTION = "production";
const ALLOWED_NODE_ENVS = new Set(["development", "test", PRODUCTION]);

const normalizeEnvValue = (value) => String(value || "").trim();

const splitCsv = (value) =>
  normalizeEnvValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const looksLikePlaceholder = (value) => {
  const normalizedValue = normalizeEnvValue(value).toLowerCase();

  return (
    !normalizedValue ||
    normalizedValue.includes("your_") ||
    normalizedValue.includes("changeme") ||
    normalizedValue.includes("replace_me") ||
    normalizedValue.includes("example") ||
    normalizedValue === "xxx"
  );
};

const looksUnsafeUrl = (value) => {
  const normalizedValue = normalizeEnvValue(value).toLowerCase();

  return (
    normalizedValue.includes("localhost") ||
    normalizedValue.includes("127.0.0.1") ||
    normalizedValue.includes("ngrok") ||
    normalizedValue.includes(".local")
  );
};

const isHttpsUrl = (value) => /^https:\/\//i.test(normalizeEnvValue(value));

const hasRealEnvValue = (name) => {
  const value = normalizeEnvValue(process.env[name]);
  return Boolean(value) && !looksLikePlaceholder(value);
};

const assertRequiredEnv = (name, { allowPlaceholder = false } = {}) => {
  const value = normalizeEnvValue(process.env[name]);

  if (!value) {
    throw new ApiError(500, `${name} is required`);
  }

  if (!allowPlaceholder && looksLikePlaceholder(value)) {
    throw new ApiError(500, `${name} must be set to a real secret or URL`);
  }

  return value;
};

export const assertRuntimeConfiguration = () => {
  const nodeEnv = normalizeEnvValue(process.env.NODE_ENV || "development");

  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new ApiError(
      500,
      `NODE_ENV must be one of: ${Array.from(ALLOWED_NODE_ENVS).join(", ")}`
    );
  }

  assertRequiredEnv("MONGO_URI");
  assertRequiredEnv("ACCESS_TOKEN_SECRET");
  assertRequiredEnv("REFRESH_TOKEN_SECRET");
  assertRequiredEnv("MENEMONIC_ENCRYPTION_KEY");
  assertRequiredEnv("TATUM_API_KEY");
  assertRequiredEnv("TATUM_WEBHOOK_HMAC_SECRET");
  assertRequiredEnv("PUBLIC_WEBHOOK_BASE_URL");
  assertRequiredEnv("BACKEND_PUBLIC_URL");
  assertRequiredEnv("CORS_ORIGINS");

  const transferMode = normalizeEnvValue(
    process.env.TATUM_TRON_TRANSFER_MODE || process.env.TRON_TRANSFER_MODE
  ).toUpperCase();

  if (transferMode && !["TRX", "TRC20"].includes(transferMode)) {
    throw new ApiError(
      500,
      "TATUM_TRON_TRANSFER_MODE must be either TRX or TRC20"
    );
  }

  if (transferMode === "TRC20") {
    assertRequiredEnv("TATUM_TRON_TRC20_TOKEN_ADDRESS");
  }

  if (nodeEnv !== PRODUCTION) {
    return;
  }

  assertRequiredEnv("TRANSAK_API_KEY");
  assertRequiredEnv("TRANSAK_API_SECRET");

  const productionUrls = [
    "PUBLIC_WEBHOOK_BASE_URL",
    "BACKEND_PUBLIC_URL",
    "TRANSAK_HOST_URL",
  ];

  for (const name of productionUrls) {
    const value = assertRequiredEnv(name);

    if (!isHttpsUrl(value)) {
      throw new ApiError(500, `${name} must use https in production`);
    }

    if (looksUnsafeUrl(value)) {
      throw new ApiError(
        500,
        `${name} cannot point to localhost, ngrok, or local domains in production`
      );
    }
  }

  for (const origin of splitCsv(process.env.CORS_ORIGINS)) {
    if (looksUnsafeUrl(origin)) {
      throw new ApiError(
        500,
        "CORS_ORIGINS cannot include localhost, ngrok, or local domains in production"
      );
    }
  }

  const referrerDomain = assertRequiredEnv("TRANSAK_REFERRER_DOMAIN");
  if (looksUnsafeUrl(referrerDomain) || /^https?:\/\//i.test(referrerDomain)) {
    throw new ApiError(
      500,
      "TRANSAK_REFERRER_DOMAIN must be a production domain only, without protocol"
    );
  }

  const allowMnemonicSignerInProduction = normalizeEnvValue(
    process.env.ALLOW_MNEMONIC_SIGNER_IN_PRODUCTION || "false"
  ).toLowerCase();

  if (
    allowMnemonicSignerInProduction !== "true" &&
    !hasRealEnvValue("TATUM_TRON_ADMIN_SIGNATURE_ID")
  ) {
    throw new ApiError(
      500,
      "TATUM_TRON_ADMIN_SIGNATURE_ID is required in production unless ALLOW_MNEMONIC_SIGNER_IN_PRODUCTION=true"
    );
  }
};

export const getRuntimeWarnings = () => {
  const warnings = [];
  const nodeEnv = normalizeEnvValue(process.env.NODE_ENV || "development");

  if (nodeEnv !== PRODUCTION) {
    warnings.push("NODE_ENV is not production");
  }

  if (looksUnsafeUrl(process.env.PUBLIC_WEBHOOK_BASE_URL)) {
    warnings.push("PUBLIC_WEBHOOK_BASE_URL points to a dev-only host");
  }

  if (looksUnsafeUrl(process.env.BACKEND_PUBLIC_URL)) {
    warnings.push("BACKEND_PUBLIC_URL points to a dev-only host");
  }

  if (looksUnsafeUrl(process.env.TRANSAK_HOST_URL)) {
    warnings.push("TRANSAK_HOST_URL points to a dev-only host");
  }

  if (!hasRealEnvValue("TRANSAK_API_KEY")) {
    warnings.push("TRANSAK_API_KEY is missing or still a placeholder");
  }

  if (!hasRealEnvValue("TRANSAK_API_SECRET")) {
    warnings.push("TRANSAK_API_SECRET is missing or still a placeholder");
  }

  const transferMode = normalizeEnvValue(
    process.env.TATUM_TRON_TRANSFER_MODE || process.env.TRON_TRANSFER_MODE
  ).toUpperCase();

  if (!transferMode) {
    warnings.push(
      "TATUM_TRON_TRANSFER_MODE is not set; defaulting to TRX transfers unless a tokenAddress is sent explicitly"
    );
  }

  if (
    nodeEnv === PRODUCTION &&
    !hasRealEnvValue("TATUM_TRON_ADMIN_SIGNATURE_ID") &&
    normalizeEnvValue(process.env.ALLOW_MNEMONIC_SIGNER_IN_PRODUCTION || "false")
      .toLowerCase() !== "true"
  ) {
    warnings.push(
      "Production signer is not pinned to Tatum KMS because TATUM_TRON_ADMIN_SIGNATURE_ID is missing"
    );
  }

  return warnings;
};
