import { Router } from "express";
import { UserWallet } from "../controller/tatum/address.controller.js";
import { getbetInfo, walletInfo } from "../controller/walletInfo.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.post("/", UserWallet);
router.get("/info", walletInfo);
router.get("/bet-info", getbetInfo);

export default router;
