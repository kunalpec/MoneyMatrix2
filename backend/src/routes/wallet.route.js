import { Router } from "express";
import { UserWallet } from "../controller/tatum/address.controller.js";
import { walletInfo,getbetInfo } from "../controller/walletInfo.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js"; 

const router = Router();

// User must be logged in to generate or fetch their wallet
router.use(verifyJWT);

// Generate/Get Tron Wallet for the User
router.post("/",UserWallet);
router.get("/info",walletInfo); // You can have a separate controller for fetching wallet info if needed
router.get("/bet-info",getbetInfo); // You can have a separate controller for fetching bet info if needed

export default router;
