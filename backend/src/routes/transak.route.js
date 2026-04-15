import express from "express";
import {
  getTransakAccessToken,
  getTransakWebhookSignature,
} from "../controller/tatum/transak.controller.js";

const router = express.Router();

router.post("/signature", getTransakWebhookSignature);
router.get("/token", getTransakAccessToken);

router.get("/success", (req, res) => {
  const {
    orderId,
    status,
    cryptoAmount,
    walletAddress
  } = req.query;

  // Save to DB (important)
  console.log({ orderId, status, cryptoAmount, walletAddress });

  res.send(`
    <h2>Payment Status: ${status}</h2>
    <p>Order ID: ${orderId}</p>
  `);
});

export default router;
