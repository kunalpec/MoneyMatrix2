import { Router } from "express";
import {
  getPlatformUsers,
  getLeaderboard,
} from "../controller/admin.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Protect all admin routes with JWT verification
router.use(verifyJWT);
router.get("/users", getPlatformUsers);
router.get("/leaderboard", getLeaderboard);

export default router;