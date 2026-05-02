import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "./db/db.js";
import { app } from "./app.js";
import http from "http";
import { StartIoServer } from "./socket/index.js";
import { gameEngine } from "./service/gameEngine.service.js";
import { startWithdrawalWorker } from "./queue/withdrawal.queue.js";
import {
  scheduleWithdrawalReconciliationJob,
  startWithdrawalReconciliationWorker,
} from "./queue/reconciliation.queue.js";
import { startDepositMonitor } from "./service/depositMonitor.service.js";
import { logger } from "./util/logger.js";
import validateEnvironment from "./scripts/validateEnvironment.js";
import {
    assertRuntimeConfiguration,
    getRuntimeWarnings,
} from "./config/runtimeValidation.js";

export const PORT = process.env.PORT || 5000;

// Graceful shutdown handler
let server;
const gracefulShutdown = async (signal) => {
  logger.info(`\n🛑 ${signal} received. Starting graceful shutdown...`);

  // Stop accepting new requests
  server?.close(async () => {
    try {
      logger.info("Closing database connections...");
      // Stop background jobs
      logger.info("Stopping game engine...");
      gameEngine.stop?.();
      logger.info("✅ Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error("Forced shutdown - graceful timeout exceeded");
    process.exit(1);
  }, 30000);
};

// Startup sequence
const startServer = async () => {
  try {
    // 1. Validate environment variables
    logger.info("🚀 MoneyMatrix Backend - Production Startup");
    validateEnvironment();

    // 2. Assert runtime configuration
    assertRuntimeConfiguration();
    for (const warning of getRuntimeWarnings()) {
        logger.info("runtime.warning", { warning });
    }

    // 3. Connect to MongoDB
    logger.info("Connecting to MongoDB...");
    await connectDB();
    logger.info("✅ MongoDB connected successfully");

    // 4. Create HTTP server with Socket.io
    server = http.createServer(app);
    StartIoServer(server);

    // 5. Initialize game engine and background jobs
    logger.info("Initializing game engine...");
    gameEngine.init();
    gameEngine.startGame();
    startWithdrawalWorker();
    startWithdrawalReconciliationWorker();
    await scheduleWithdrawalReconciliationJob();
    startDepositMonitor();

    // 6. Start listening
    server.on("error", (err) => {
      logger.error("server.error", { error: err.message });
    });

    server.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info("✅ Socket.io server initialized");
      logger.info("✅ Game engine started");
      logger.info("✅ Background workers started");
      logger.info("Ready to accept requests!");
    });

    // 7. Setup graceful shutdown handlers
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    return server;
  } catch (error) {
    logger.error("❌ Failed to start server:", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

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

// Start the server
startServer();

export default startServer;
