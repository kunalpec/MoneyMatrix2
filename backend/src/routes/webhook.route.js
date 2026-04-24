import { Router } from "express";
import {
  tronWebhook,
  tronWithdrawWebhook,
  transakWebhook,
} from "../controller/tatum/webhook.controller.js";

const router = Router();

router.post("/tatum/deposit", tronWebhook);
router.post("/tatum/address", tronWebhook);
router.post("/tatum/withdraw", tronWithdrawWebhook);

router.post("/transak", transakWebhook);
router.post("/transak/deposit", transakWebhook);
router.post("/transak/withdraw", transakWebhook);

export default router;
