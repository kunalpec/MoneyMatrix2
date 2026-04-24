import axios from "axios";
import { ApiError } from "../util/ApiError.util.js";
import { logger } from "../util/logger.util.js";

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
  const apiKey = process.env.TATUM_API_KEY || process.env.TATUM_API_KEY_KUNAL;

  if (!apiKey) {
    throw new ApiError(500, "TATUM_API_KEY is missing");
  }

  return apiKey;
};

export const getTatumDepositWebhookUrl = () =>
  `${resolvePublicWebhookBaseUrl()}/api/v1/webhook/tatum/address`;

export const createDepositWebhookSubscription = async (address) => {
  const webhookUrl = getTatumDepositWebhookUrl();

  try {
    const response = await axios.post(
      "https://api.tatum.io/v4/subscription?type=mainnet",
      {
        // TRON mainnet address subscriptions are created via ADDRESS_EVENT in Tatum.
        type: "ADDRESS_EVENT",
        attr: {
          chain: "TRON",
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
