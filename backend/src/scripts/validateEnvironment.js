import dotenv from "dotenv";
import { logger } from "../util/logger.js";

dotenv.config();

/**
 * Environment Validation Script
 * Validates that all required environment variables are set
 * Run this on application startup (BEFORE connecting to databases)
 */

const REQUIRED_ENV_VARS = [
  "NODE_ENV",
  "PORT",
  "MONGO_URI",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "CORS_ORIGINS",
  "TATUM_API_KEY",
  "TATUM_WEBHOOK_HMAC_SECRET",
  "TATUM_TRON_ADMIN_ADDRESS",
  "TATUM_TRON_ADMIN_SIGNATURE_ID",
];

const OPTIONAL_ENV_VARS = [
  "LOG_LEVEL",
  "REDIS_URL",
  "SENTRY_DSN",
  "BACKEND_PUBLIC_URL",
  "PUBLIC_WEBHOOK_BASE_URL",
];

export const validateEnvironment = () => {
  logger.info("=".repeat(60));
  logger.info("🔍 Environment Validation Started");
  logger.info("=".repeat(60));

  const missing = [];
  const warnings = [];
  const secure = [];

  // Check required variables
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
      logger.error(`❌ MISSING REQUIRED: ${envVar}`);
    } else {
      const value = process.env[envVar];
      const isSensitive =
        envVar.includes("SECRET") ||
        envVar.includes("TOKEN") ||
        envVar.includes("PASSWORD") ||
        envVar.includes("API_KEY") ||
        envVar.includes("URI");

      if (isSensitive) {
        secure.push(`${envVar}: ${value.substring(0, 4)}...${value.slice(-4)}`);
        logger.info(`✅ ${envVar}: [SENSITIVE - HIDDEN]`);
      } else {
        logger.info(`✅ ${envVar}: ${value}`);
      }
    }
  }

  // Check optional variables
  for (const envVar of OPTIONAL_ENV_VARS) {
    if (!process.env[envVar]) {
      warnings.push(envVar);
      logger.warn(`⚠️  OPTIONAL NOT SET: ${envVar}`);
    } else {
      logger.info(`✅ ${envVar}: ${process.env[envVar]}`);
    }
  }

  // Production-specific checks
  if (process.env.NODE_ENV === "production") {
    if (!process.env.SENTRY_DSN) {
      warnings.push("SENTRY_DSN (recommended for production error tracking)");
    }
    if (!process.env.REDIS_URL) {
      warnings.push("REDIS_URL (recommended for session caching)");
    }

    // Check secret strength
    const secretLength = (process.env.ACCESS_TOKEN_SECRET || "").length;
    if (secretLength < 32) {
      warnings.push(`ACCESS_TOKEN_SECRET too short (${secretLength} chars)`);
      logger.warn(`⚠️  ACCESS_TOKEN_SECRET should be at least 32 characters`);
    }
  }

  logger.info("=".repeat(60));
  logger.info("📊 Environment Validation Summary");
  logger.info("=".repeat(60));
  logger.info(`✅ Required Variables Found: ${REQUIRED_ENV_VARS.length - missing.length}/${REQUIRED_ENV_VARS.length}`);
  logger.info(`✅ Optional Variables Found: ${OPTIONAL_ENV_VARS.length - warnings.length}/${OPTIONAL_ENV_VARS.length}`);

  if (missing.length > 0) {
    logger.error(`\n❌ FATAL: ${missing.length} Required variables missing:`);
    missing.forEach((v) => logger.error(`   - ${v}`));
    logger.info("=".repeat(60));
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (warnings.length > 0) {
    logger.warn(`\n⚠️  ${warnings.length} Optional variables not set:`);
    warnings.forEach((v) => logger.warn(`   - ${v}`));
  }

  logger.info("\n✅ Environment validation PASSED!");
  logger.info("=".repeat(60));

  return {
    isValid: true,
    missing,
    warnings,
    environment: process.env.NODE_ENV,
  };
};

// Run if executed directly
if (process.argv[1]?.includes("validateEnvironment")) {
  try {
    validateEnvironment();
    process.exit(0);
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

export default validateEnvironment;
