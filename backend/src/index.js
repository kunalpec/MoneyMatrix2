import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "./db/db.js";
import { app } from "./app.js";
import http from "http";
import { StartIoServer } from "./socket/index.js";
import { gameEngine } from "./service/gameEngine.service.js";
import { startWithdrawalWorker } from "./queue/withdrawal.queue.js";
import { startDepositMonitor } from "./service/depositMonitor.service.js";
import { logger } from "./util/logger.util.js";
import {
    assertRuntimeConfiguration,
    getRuntimeWarnings,
} from "./config/runtimeValidation.js";

export const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

StartIoServer(server);

assertRuntimeConfiguration();

connectDB().then(()=>{
    for (const warning of getRuntimeWarnings()) {
        logger.info("runtime.warning", { warning });
    }

    // Initialize the game engine after DB is connected
    gameEngine.init();
    gameEngine.startGame();
    startWithdrawalWorker();
    startDepositMonitor();
    // start the server
    server.on("error",()=>{
        logger.error("server.error");
    });
    // listent the server
    server.listen(PORT,()=>{
        logger.info("server.started", { port: PORT });
    });
}).catch((error)=>{
    logger.error("server.bootstrap_failed", { error: error.message });
});
