import { AsyncHandler } from "../util/AsyncHandler.util.js";
import { ApiError } from "../util/ApiError.util.js";
import { ApiResponse } from "../util/ApiResponse.util.js";
import { User } from "../model/user.model.js";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { SendCustomEmail } from "../util/SendEmail.util.js";

/* =========================
   TWILIO CONFIG
========================= */
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

/* =========================
   COOKIE OPTIONS
========================= */
const cookieOptions = {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production"
};

const resolveSignupRole = (requestedRole, adminKey) => {
    if (requestedRole !== "admin") {
        return "user";
    }

    const expectedAdminKey = String(process.env.ADMIN_SIGNUP_KEY || "").trim();
    if (!expectedAdminKey) {
        throw new ApiError(403, "Admin signup is disabled");
    }

    if (String(adminKey || "").trim() !== expectedAdminKey) {
        throw new ApiError(403, "Invalid admin signup key");
    }

    return "admin";
};

/* =========================
   SIGNUP
========================= */
export const userSignup = AsyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim(); // Schema uses 'name'
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const phone = String(req.body.phone || "").trim();
    const requestedRole = String(req.body.role || "user").trim().toLowerCase();
    const adminKey = String(req.body.adminKey || "").trim();

    if (!name || !email || !phone || !password) {
        throw new ApiError(400, "All fields required");
    }

    const role = resolveSignupRole(requestedRole, adminKey);

    let user = await User.findOne({ $or: [{ email }, { phone }] });

    if (user && user.otp === null && !user.otpExpires) {
        // Assuming if OTP is cleared, user is 'verified' or active
        throw new ApiError(409, "User already exists");
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const hashedOtp = await bcrypt.hash(otp, 10);

    if (!user) {
        user = new User({ name, email, phone, password, role });
    } else {
        user.name = name;
        user.email = email;
        user.phone = phone;
        user.password = password;
        user.role = role;
    }

    user.otp = hashedOtp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await user.save();

    // Send Email
    try {
        await SendCustomEmail({
            to: email,
            subject: "Your OTP Code",
            text: `Your OTP is ${otp}`
        });
    } catch (err) { console.error("Email Error:", err.message); }

    // Send SMS
    try {
        if (process.env.TWILIO_PHONE_NUMBER) {
            await twilioClient.messages.create({
                body: `Your OTP is: ${otp}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            });
        }
    } catch (err) { console.error("SMS Error:", err.message); }

    return res.json(new ApiResponse(200, {}, "OTP sent successfully"));
});

/* =========================
   VERIFY OTP (SIGNUP)
========================= */
export const verifyUserOTP = AsyncHandler(async (req, res) => {
    const phone = String(req.body.phone || "").trim();
    const otp = String(req.body.otp || "");
    if (!phone || !otp) throw new ApiError(400, "Phone and OTP required");
    const user = await User.findOne({ phone });

    if (!user) throw new ApiError(404, "User not found");

    const isOtpValid = await bcrypt.compare(otp, user.otp || "");
    if (!isOtpValid) throw new ApiError(400, "Invalid OTP");

    if (user.otpExpires < Date.now()) {
        throw new ApiError(400, "OTP expired");
    }

    // Clear OTP fields
    user.otp = null;
    user.otpExpires = null;
    user.isVerified = true;
    // Use your schema methods
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    await user.save({ validateBeforeSave: false });

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json(new ApiResponse(200, { user, accessToken }, "Account verified"));
});

/* =========================
   LOGIN
========================= */
export const userLogin = AsyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");

    if ((!email && !phone) || !password) {
        throw new ApiError(400, "Email/Phone and password required");
    }

    const user = await User.findOne(phone ? { phone } : { email });

    if (!user) throw new ApiError(404, "User not found");
    if (!user.isVerified) throw new ApiError(403, "Please verify your account first");

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) throw new ApiError(401, "Invalid credentials");

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    await user.save({ validateBeforeSave: false });

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json(new ApiResponse(200, { user, accessToken }, "Login successful"));
});

/* =========================
   REFRESH TOKEN
========================= */
export const refreshUserToken = AsyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!incomingRefreshToken) throw new ApiError(401, "Unauthorized request");

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id);

        if (!user || user.refreshToken !== incomingRefreshToken) {
            throw new ApiError(401, "Invalid refresh token");
        }

        const accessToken = user.generateAccessToken();
        const newRefreshToken = user.generateRefreshToken();

        await user.save({ validateBeforeSave: false });

        res.cookie("accessToken", accessToken, cookieOptions);
        res.cookie("refreshToken", newRefreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json(new ApiResponse(200, { accessToken }, "Token refreshed"));
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }
});

/* =========================
   LOGOUT
========================= */
export const userLogout = AsyncHandler(async (req, res) => {
    // req.user is usually attached by an auth middleware
    await User.findByIdAndUpdate(
        req.user._id,
        { $set: { refreshToken: null } },
        { returnDocument: "after" }
      );

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    return res.json(new ApiResponse(200, {}, "Logged out"));
});

/* =========================
   FORGOT / RESET PASSWORD
========================= */
export const userForgotPassword = AsyncHandler(async (req, res) => {
    const phone = String(req.body.phone || "").trim();
    const newpassword = String(req.body.newpassword || "").trim();
    if (!phone || !newpassword) throw new ApiError(400, "Phone and new password required");

    const user = await User.findOne({ phone });
    if (!user) throw new ApiError(404, "User not found");
    const email = String(user.email || "").trim().toLowerCase();

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.newpassword = newpassword; // Store new password temporarily until OTP is verified
    await user.save({ validateBeforeSave: false });

    // Send SMS/Email logic (same as signup)...
    // Send Email
    try {
        if (email) {
            await SendCustomEmail({
                to: email,
                subject: "Your OTP Code",
                text: `Your OTP is ${otp}`
            });
        }
    } catch (err) { console.error("Email Error:", err.message); }

    // Send SMS
    try {
        if (process.env.TWILIO_PHONE_NUMBER) {
            await twilioClient.messages.create({
                body: `Your OTP is: ${otp}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            });
        }
    } catch (err) { console.error("SMS Error:", err.message); }
    return res.json(new ApiResponse(200, {}, "Reset OTP sent"));
});

export const userResetPassword = AsyncHandler(async (req, res) => {
    const { phone, otp} = req.body;
    if (!phone || !otp) throw new ApiError(400, "Phone and OTP required");
    const user = await User.findOne({ phone });
    if (!user) throw new ApiError(404, "User not found");

    const isOtpValid = await bcrypt.compare(otp, user.otp || "");
    if (!isOtpValid || user.otpExpires < Date.now()) {
        throw new ApiError(400, "Invalid or expired OTP");
    }

    user.password = user.newpassword; // Pre-save hook will hash this
    user.otp = null;
    user.newpassword = null;
    user.otpExpires = null;
    user.refreshToken = null;
    await user.save();

    return res.json(new ApiResponse(200, {}, "Password reset successful"));
});
