import { Router } from "express";
import {
  tronWebhook,
  tronWithdrawWebhook,
  transakWebhook,
} from "../controller/tatum/webhook.controller.js";

const router = Router();

/**
 * ⚠️ Do NOT add verifyJWT here. 
 * Webhooks are called by external servers (Tatum/Transak) and use signature headers for security.
 */
router.post("/tatum/deposit", tronWebhook);
router.post("/tatum/withdraw", tronWithdrawWebhook);

// // Explicit Transak webhook routes for order status updates.
// router.post("/transak/deposit", transakWebhook);
// router.post("/transak/withdraw", transakWebhook);

// Backward-compatible alias for existing Transak webhook integrations.
router.post("/transak", transakWebhook);

export default router;
