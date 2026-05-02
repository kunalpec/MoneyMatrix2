import { Router } from "express";
import {
  getPlatformUsers,
  getLeaderboard,
  getAdminWalletSummary,
} from "../controller/admin.controller.js";
import { requireRole, verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);
router.use(requireRole("admin"));

router.get("/users", getPlatformUsers);
router.get("/leaderboard", getLeaderboard);
router.get("/wallet", getAdminWalletSummary);

export default router;
