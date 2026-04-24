import express from "express";
import {
  getTransakAccessToken,
  getTransakWebhookSignature,
} from "../controller/tatum/transak.controller.js";

const router = express.Router();

router.post("/signature", getTransakWebhookSignature);
router.get("/token", getTransakAccessToken);

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const buildSuccessMetadata = (query, flowLabel) => ({
  provider: "TRANSAK",
  flow: flowLabel,
  orderId: firstValue(query.orderId, query.order_id),
  partnerOrderId: firstValue(query.partnerOrderId, query.partner_order_id),
  status: query.status,
  cryptoAmount: firstValue(query.cryptoAmount, query.crypto_amount),
  fiatAmount: firstValue(query.fiatAmount, query.fiat_amount),
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

    res.send(`
      <h2>${flowLabel} Status: ${status || "PENDING"}</h2>
      <p>Order ID: ${firstValue(orderId, order_id) || "-"}</p>
      <p>Partner Order ID: ${firstValue(partnerOrderId, partner_order_id) || "-"}</p>
      <p>Crypto Amount: ${firstValue(cryptoAmount, crypto_amount) || "-"}</p>
      <p>Wallet Address: ${firstValue(walletAddress, wallet_address) || "-"}</p>
      <p>This page is informational only. Final payment state comes from Transak/Tatum webhooks.</p>
      <pre>${JSON.stringify(metadata, null, 2)}</pre>
    `);
  } catch (error) {
    next(error);
  }
};

router.get("/success", renderTransakSuccessPage("Transak"));
router.get("/on-ramp/success", renderTransakSuccessPage("On-ramp"));
router.get("/off-ramp/success", renderTransakSuccessPage("Off-ramp"));

export default router;
