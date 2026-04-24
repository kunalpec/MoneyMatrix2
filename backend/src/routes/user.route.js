import { Router } from "express";
import {
  userSignup,
  verifyUserOTP,
  userLogin,
  userLogout,
  refreshUserToken,
  userForgotPassword,
  userResetPassword,
  getCurrentUser,
} from "../controller/auth.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/register", userSignup);
router.post("/login", userLogin);
router.post("/forgot-password", userForgotPassword);
router.post("/reset-password", userResetPassword);
router.post("/verify-otp", verifyUserOTP);
router.post("/refresh-token", refreshUserToken);
router.get("/me", verifyJWT, getCurrentUser);
router.get("/logout", verifyJWT, userLogout);

export default router;
