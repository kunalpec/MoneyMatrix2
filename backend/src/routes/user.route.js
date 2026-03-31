import { Router } from "express";
import {
    userSignup,
    verifyUserOTP,
    userLogin,
    userLogout,
    refreshUserToken,   
    userForgotPassword,
    userResetPassword,
} from "../controller/auth.controller.js"; // Adjust the path/names if necessary
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// 🟢 Public routes (No authentication required)
router.post("/register", userSignup);
router.post("/login", userLogin);
router.post("/forgot-password",userForgotPassword);
router.post("/reset-password",userResetPassword);
router.post("/verify-otp",verifyUserOTP)

router.post("/refresh-token", refreshUserToken);
router.get("/logout",verifyJWT, userLogout);


export default router;
