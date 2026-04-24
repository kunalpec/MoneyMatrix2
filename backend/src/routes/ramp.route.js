import { Router } from "express";
import {
  createOnRampUrl,
  createOffRampUrl,
  withdrawTrx,
} from "../controller/tatum/ramp.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.post("/on-ramp", createOnRampUrl);
router.post("/off-ramp", createOffRampUrl);
router.post("/withdraw", withdrawTrx);

export default router;
