import express from "express";
import {
  createTransakWebhookJwt,
  getTransakAccessToken,
} from "../controller/tatum/transak.controller.js";
import { requireRole, verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const ensureAdmin = [verifyJWT, requireRole("admin")];

router.post("/jwt-token", ...ensureAdmin, createTransakWebhookJwt);
router.get("/token", ...ensureAdmin, getTransakAccessToken);

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, fieldValue]) =>
        fieldValue !== undefined &&
        fieldValue !== null &&
        fieldValue !== ""
    )
  );

const buildSuccessMetadata = (query, flowLabel) =>
  compactObject({
    provider: "TRANSAK",
    flow: flowLabel,
    eventId: firstValue(query.eventId, query.eventID),
    eventID: firstValue(query.eventID, query.eventId),
    orderId: firstValue(query.orderId, query.order_id),
    partnerOrderId: firstValue(query.partnerOrderId, query.partner_order_id),
    status: firstValue(query.status),
    fiatAmount: firstValue(query.fiatAmount, query.fiat_amount),
    fiatCurrency: firstValue(query.fiatCurrency, query.fiat_currency),
    countryCode: firstValue(query.countryCode, query.country_code),
    walletAddress: firstValue(query.walletAddress, query.wallet_address),
  });

const renderTransakSuccessPage = (flowLabel) => async (req, res, next) => {
  const {
    orderId,
    order_id,
    partnerOrderId,
    partner_order_id,
    status,
    cryptoAmount,
    crypto_amount,
    walletAddress,
    wallet_address,
  } = req.query;

  try {
    const metadata = buildSuccessMetadata(req.query, flowLabel);
    const escapedFlowLabel = escapeHtml(flowLabel);
    const escapedStatus = escapeHtml(status || "PENDING");
    const escapedOrderId = escapeHtml(firstValue(orderId, order_id) || "-");
    const escapedPartnerOrderId = escapeHtml(
      firstValue(partnerOrderId, partner_order_id) || "-"
    );
    const escapedCryptoAmount = escapeHtml(
      firstValue(cryptoAmount, crypto_amount) || "-"
    );
    const escapedWalletAddress = escapeHtml(
      firstValue(walletAddress, wallet_address) || "-"
    );
    const escapedMetadata = escapeHtml(JSON.stringify(metadata, null, 2));

    res.send(`
      <h2>${escapedFlowLabel} Status: ${escapedStatus}</h2>
      <p>Order ID: ${escapedOrderId}</p>
      <p>Partner Order ID: ${escapedPartnerOrderId}</p>
      <p>Crypto Amount: ${escapedCryptoAmount}</p>
      <p>Wallet Address: ${escapedWalletAddress}</p>
      <p>This page is informational only. Final payment state comes from Transak/Tatum webhooks.</p>
      <pre>${escapedMetadata}</pre>
    `);
  } catch (error) {
    next(error);
  }
};

router.get("/success", renderTransakSuccessPage("Transak"));
router.get("/on-ramp/success", renderTransakSuccessPage("On-ramp"));
router.get("/off-ramp/success", renderTransakSuccessPage("Off-ramp"));

export default router;
