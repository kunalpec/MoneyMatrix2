import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { logger } from "../util/logger.js";

// Rate limiting for general API endpoints
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use IP
    return req.user?.id || ipKeyGenerator(req.ip);
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === "/health";
  },
  handler: (req, res) => {
    logger.warn("Rate limit exceeded", {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      success: false,
      message: "Too many requests, please try again later.",
      statusCode: 429,
    });
  },
});

// Strict rate limiting for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: "Too many login attempts, please try again after 15 minutes.",
  skipSuccessfulRequests: true, // Don't count successful requests
  keyGenerator: (req) => {
    return req.body?.email || req.body?.phone || ipKeyGenerator(req.ip);
  },
  handler: (req, res) => {
    logger.warn("Auth rate limit exceeded", {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      success: false,
      message:
        "Too many login attempts, please try again after 15 minutes.",
      statusCode: 429,
    });
  },
});

// Rate limiting for webhook endpoints (more lenient)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // high limit for webhook traffic
  message: "Webhook rate limit exceeded",
  keyGenerator: (req) => {
    return req.get("x-tatum-key") || ipKeyGenerator(req.ip); // IPv6-safe fallback
  },
});

// Security headers middleware
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: "deny",
  },
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin",
  },
});

// Input sanitization middleware
export const inputSanitizer = (req, res, next) => {
  // Remove any suspicious patterns from inputs
  const sanitize = (obj) => {
    if (typeof obj === "string") {
      // Remove script tags and SQL injection patterns
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/[;'"`]/g, (match) => {
          return {
            ";": "",
            "'": "\\'",
            '"': '\\"',
            "`": "\\`",
          }[match];
        });
    } else if (Array.isArray(obj)) {
      for (let index = 0; index < obj.length; index += 1) {
        obj[index] = sanitize(obj[index]);
      }
    } else if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((key) => {
        obj[key] = sanitize(obj[key]);
      });
    }
    return obj;
  };

  sanitize(req.body);
  sanitize(req.query);
  sanitize(req.params);

  next();
};

// Request timeout middleware
export const requestTimeout = (req, res, next) => {
  const timeout = 30000; // 30 seconds
  res.setTimeout(timeout, () => {
    logger.warn("Request timeout", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(408).json({
      success: false,
      message: "Request timeout",
      statusCode: 408,
    });
  });
  next();
};

// CORS trusted domains
export const corsSecurityHeaders = (req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",");

  if (allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }

  res.set("Access-Control-Allow-Credentials", "true");
  res.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS"
  );
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
};

export default {
  generalLimiter,
  authLimiter,
  webhookLimiter,
  securityHeaders,
  inputSanitizer,
  requestTimeout,
  corsSecurityHeaders,
};
