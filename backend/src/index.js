import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "./db/db.js";
import { app } from "./app.js";
import http from "http";
import { StartIoServer } from "./socket/index.js";
import { gameEngine } from "./service/gameEngine.service.js";

export const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

StartIoServer(server);

connectDB().then(()=>{
    // Initialize the game engine after DB is connected
    gameEngine.init();
    gameEngine.startGame();
    // start the server
    server.on("error",()=>{
        console.log("server error from index.js file");
    });
    // listent the server
    server.listen(PORT,()=>{
        console.log(`server is running on : http://localhost:${PORT}`);
    });
}).catch((error)=>{
    console.log("Error msg: ",error.message);
});
