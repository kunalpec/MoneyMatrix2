import { Router } from "express";
import {
  createOnRampUrl,
  createOffRampUrl,
  withdrawTrx,
} from "../controller/tatum/ramp.controller.js";
// Assuming you have an auth middleware to populate req.user
import { verifyJWT } from "../middleware/auth.middleware.js"; 

const router = Router();

// Secure all these routes since they use req.user
router.use(verifyJWT);

// Generate Transak Buy URL (Crypto On-ramp)
router.post("/on-ramp",createOnRampUrl);

// Generate Transak Sell URL (Crypto Off-ramp)
router.post("/off-ramp",createOffRampUrl);

// Withdraw TRX to external wallet
router.post("/withdraw",withdrawTrx);


export default router;
