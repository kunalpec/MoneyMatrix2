import { Router } from "express";
import {
  createTatumWebhookHmac,
  tronWebhook,
  transakWebhook,
} from "../controller/tatum/webhook.controller.js";
import { requireRole, verifyJWT } from "../middleware/auth.middleware.js";
import { Wallet } from "../model/wallet.model.js";
import { ApiError } from "../util/ApiError.util.js";
import { replaceDepositWebhookSubscription } from "../service/tatumSubscription.service.js";

export const registerTatumWebhook = async (req, res) => {
  try {
    const adminWallet = await Wallet.findOne({ isAdmin: true });

    if (!adminWallet?.address) {
      throw new ApiError(404, "Admin wallet address not found");
    }

    const configuredAddress = String(
      process.env.TATUM_TRON_ADMIN_ADDRESS || ""
    ).trim();

    if (configuredAddress && configuredAddress !== adminWallet.address) {
      throw new ApiError(
        409,
        `Admin address mismatch. .env has ${configuredAddress} but DB admin wallet is ${adminWallet.address}`
      );
    }

    const subscriptionId = await replaceDepositWebhookSubscription({
      address: adminWallet.address,
      existingSubscriptionId: adminWallet.depositSubscriptionId,
    });

    adminWallet.depositSubscriptionId = subscriptionId;
    await adminWallet.save();

    return res.status(200).json({
      success: true,
      message: "Webhook registered successfully",
      data: {
        address: adminWallet.address,
        subscriptionId,
      },
    });
  } catch (error) {
    console.error(
      "Webhook registration error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to register webhook",
      error: error.response?.data || error.message,
    });
  }
};

const router = Router();

router.post("/tatum/address", tronWebhook);
router.post("/transak", transakWebhook);



// postman only 
router.post(
  "/tatum/hmac",
  verifyJWT,
  requireRole("admin"),
  createTatumWebhookHmac
);

router.post(
  "/tatum/register-webhook",
  verifyJWT,
  requireRole("admin"),
  registerTatumWebhook
);

export default router;
