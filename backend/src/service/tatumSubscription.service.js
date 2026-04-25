import axios from "axios";
import { ApiError } from "../util/ApiError.util.js";
import { logger } from "../util/logger.util.js";

const TATUM_TRON_CHAIN = "TRON";
const TATUM_TRON_NATIVE_SUBSCRIPTION_TYPE = "INCOMING_NATIVE_TX";

const resolvePublicWebhookBaseUrl = () => {
  const configuredBaseUrl =
    process.env.PUBLIC_WEBHOOK_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL;

  if (!configuredBaseUrl) {
    throw new ApiError(
      500,
      "PUBLIC_WEBHOOK_BASE_URL or BACKEND_PUBLIC_URL is required for webhook subscriptions"
    );
  }

  const normalizedBaseUrl = String(configuredBaseUrl).trim().replace(/\/+$/, "");

  if (!/^https:\/\//i.test(normalizedBaseUrl)) {
    throw new ApiError(
      500,
      "Webhook subscription base URL must be public HTTPS"
    );
  }

  return normalizedBaseUrl;
};

const getTatumApiKey = () => {
  const apiKey = process.env.TATUM_API_KEY;

  if (!apiKey) {
    throw new ApiError(500, "TATUM_API_KEY is missing");
  }

  return apiKey;
};

const getTatumWebhookHmacSecret = () => {
  const hmacSecret = process.env.TATUM_WEBHOOK_HMAC_SECRET;

  if (!hmacSecret) {
    throw new ApiError(500, "TATUM_WEBHOOK_HMAC_SECRET is required");
  }

  return hmacSecret;
};

export const getTatumAddressWebhookUrl = () =>
  `${resolvePublicWebhookBaseUrl()}/api/v1/webhook/tatum/address`;

export const getTatumDepositWebhookUrl = getTatumAddressWebhookUrl;

export const deleteTatumSubscription = async (subscriptionId) => {
  const normalizedSubscriptionId = String(subscriptionId || "").trim();

  if (!normalizedSubscriptionId) {
    return false;
  }

  try {
    await axios.delete(
      `https://api.tatum.io/v4/subscription/${normalizedSubscriptionId}`,
      {
        headers: {
          "x-api-key": getTatumApiKey(),
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    logger.info("tatum.subscription.deleted", {
      subscriptionId: normalizedSubscriptionId,
    });

    return true;
  } catch (error) {
    const statusCode = error?.response?.status || 500;
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to delete Tatum subscription";

    if (statusCode === 404 || /no such subscription/i.test(message)) {
      logger.info("tatum.subscription.delete_skipped", {
        subscriptionId: normalizedSubscriptionId,
        reason: "not_found",
      });
      return false;
    }

    logger.error("tatum.subscription.delete_failed", {
      subscriptionId: normalizedSubscriptionId,
      error: message,
      response: error?.response?.data,
    });

    throw new ApiError(502, message);
  }
};

export const enableTatumWebhookHmac = async () => {
  try {
    await axios.put(
      "https://api.tatum.io/v4/subscription",
      {
        hmacSecret: getTatumWebhookHmacSecret(),
      },
      {
        headers: {
          "x-api-key": getTatumApiKey(),
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    logger.info("tatum.webhook_hmac.enabled");
    return true;
  } catch (error) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to enable Tatum webhook HMAC";

    logger.error("tatum.webhook_hmac.enable_failed", {
      error: message,
      response: error?.response?.data,
    });

    throw new ApiError(502, message);
  }
};

export const createDepositWebhookSubscription = async (address) => {
  const webhookUrl = getTatumAddressWebhookUrl();

  try {
    const response = await axios.post(
      "https://api.tatum.io/v4/subscription?type=mainnet",
      {
        type: TATUM_TRON_NATIVE_SUBSCRIPTION_TYPE,
        attr: {
          chain: TATUM_TRON_CHAIN,
          address,
          url: webhookUrl,
        },
      },
      {
        headers: {
          "x-api-key": getTatumApiKey(),
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    logger.info("tatum.subscription.created", {
      address,
      webhookUrl,
      response: response?.data,
    });

    const subscriptionId = response?.data?.id || response?.data?.data?.id;

    if (!subscriptionId) {
      throw new ApiError(502, "Tatum subscription created without an id");
    }

    return subscriptionId;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to create Tatum webhook subscription";

    logger.error("tatum.subscription.failed", {
      address,
      error: message,
      response: error?.response?.data,
    });

    throw new ApiError(502, message);
  }
};

export const replaceDepositWebhookSubscription = async ({
  address,
  existingSubscriptionId = null,
}) => {
  if (existingSubscriptionId) {
    await deleteTatumSubscription(existingSubscriptionId);
  }

  return createDepositWebhookSubscription(address);
};
