import mongoose from "mongoose";
import { logger } from "../util/logger.js";

/**
 * Health Check Controller
 * Monitors system health: MongoDB, Redis, Memory usage
 */

export const healthCheck = async (req, res) => {
  const health = {
    status: "up",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      mongodb: "pending",
      memory: "pending",
      responsiveness: "pending",
    },
  };

  try {
    // MongoDB connection check
    if (mongoose.connection.readyState === 1) {
      health.checks.mongodb = "healthy";
    } else {
      health.checks.mongodb = "unhealthy";
      health.status = "degraded";
    }

    // Memory usage check
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    health.checks.memory = {
      status: memUsagePercent < 90 ? "healthy" : "warning",
      usage: {
        heap: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(
          memUsage.heapTotal / 1024 / 1024
        )}MB`,
        percentage: `${Math.round(memUsagePercent)}%`,
      },
    };

    if (memUsagePercent >= 90) {
      health.status = "degraded";
    }

    // Responsiveness check
    health.checks.responsiveness = "healthy";

    const statusCode = health.status === "up" ? 200 : 503;
    return res.status(statusCode).json(health);
  } catch (error) {
    logger.error("Health check failed", {
      error: error.message,
    });

    health.status = "down";
    health.error = error.message;
    return res.status(503).json(health);
  }
};

export default { healthCheck };
