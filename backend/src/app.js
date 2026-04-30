import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";
import { logger, httpLogger } from "./util/logger.js";
import {
  securityHeaders,
  generalLimiter,
  authLimiter,
  webhookLimiter,
  inputSanitizer,
  requestTimeout,
} from "./middleware/security.middleware.js";
import { handleValidationErrors } from "./middleware/request-validation.middleware.js";

// Routes
import adminRouter from "./routes/admin.route.js";
import rampRouter from "./routes/ramp.route.js";
import transakRouter from "./routes/transak.route.js";
import userRouter from "./routes/user.route.js";
import walletRouter from "./routes/wallet.route.js";
import webhookRouter from "./routes/webhook.route.js";

// Middleware
import { errorHandler } from "./middleware/error.middleware.js";
import { verifyJWT } from "./middleware/auth.middleware.js";
import { getCurrentUser } from "./controller/auth.controller.js";

// Health check controller
import { healthCheck } from "./controller/health.controller.js";

export const app = express();

// ============================================================================
// PRODUCTION SECURITY & PERFORMANCE MIDDLEWARE
// ============================================================================

// Security Headers (BEFORE CORS)
app.use(securityHeaders);

// CORS (with production config)
app.use((req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",");

  if (
    !process.env.NODE_ENV ||
    process.env.NODE_ENV === "development" ||
    allowedOrigins.some((o) => origin?.includes(o.trim()))
  ) {
    res.set("Access-Control-Allow-Origin", origin || "*");
    res.set("Access-Control-Allow-Credentials", "true");
  }

  res.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS"
  );
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Request timeout
app.use(requestTimeout);

// Compression for responses
app.use(compression());

// HTTP Logging (BEFORE body parsing for full context)
app.use(httpLogger);

// Body parsing (raw body for webhook verification)
app.use("/api/v1/webhook/tatum/address", express.raw({ type: "*/*" }));
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
    limit: "10mb",
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Cookie parsing
app.use(cookieParser());

// Input sanitization
app.use(inputSanitizer);

// ============================================================================
// RATE LIMITING
// ============================================================================
app.use("/api/v1/users/auth/login", authLimiter);
app.use("/api/v1/users/auth/signup", authLimiter);
app.use("/api/v1/users/auth/forgot-password", authLimiter);
app.use("/api/v1/webhook", webhookLimiter);
app.use("/api/", generalLimiter);

// ============================================================================
// HEALTH CHECK ENDPOINT (Should be monitored)
// ============================================================================
app.get("/health", healthCheck);

// ============================================================================
// API ROUTES
// ============================================================================

// Public routes
app.use("/api/v1/users", userRouter);
app.get("/api/v1/auth/me", verifyJWT, getCurrentUser);

// Protected Admin routes
app.use("/api/v1/admin", verifyJWT, adminRouter);

// Protected Wallet routes
app.use("/api/v1/wallet", verifyJWT, walletRouter);

// Payment ramps
app.use("/api/v1/ramp", rampRouter);

// Webhook routes (HMAC verified, not JWT)
app.use("/api/v1/webhook", webhookRouter);
app.use("/api/v1/transak", transakRouter);

// ============================================================================
// 404 HANDLER
// ============================================================================
app.use((req, res) => {
  logger.warn("404 Not Found", {
    path: req.path,
    method: req.method,
    ip: req.ip,
  });
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    statusCode: 404,
  });
});

// ============================================================================
// ERROR HANDLING (MUST BE LAST)
// ============================================================================
app.use(errorHandler);

// Unhandled rejection handler
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", {
    promise: promise.toString(),
    reason: reason.message || reason,
  });
});

// Uncaught exception handler
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", {
    message: error.message,
    stack: error.stack,
  });
  // Exit the process after logging
  process.exit(1);
});

export default app;
