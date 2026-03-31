import { Server } from "socket.io";
import { corsOptions } from "../config/cors.js";
import { socketAuthMiddleware } from "../middleware/socket.middleware.js";
import { gameEngine } from "../service/gameEngine.service.js";

let io;

const StartIoServer = (server) => {
    if (io) {
        console.log("Socket.IO already initialized");
        return io;
    }

    try {
        io = new Server(server, { cors: corsOptions });

        // 1. Apply Middleware FIRST
        // This ensures every connection below has a 'user' object attached
        io.use(socketAuthMiddleware);

        console.log("✅ Socket.IO started successfully");

        // 2. SINGLE Connection Block (Merged your two blocks)
        io.on("connection", async (socket) => {
            const user = socket.user; // Attached by middleware
            if (!user) {
                console.log("Connection rejected: No user found");
                return socket.disconnect();
            }

            const userId = user._id.toString();
            console.log(`Connected: ${user.name} (${user.role}) - ID: ${socket.id}`);

            // 3. Register user in GameEngine (Handles room joining internally)
            // Note: Your GameEngine.joinGame already handles 'admin-room' logic
            await gameEngine.joinGame(user, socket);

            // 4. Handle Place Bet (User Only)
            socket.on("place-bet", async (data) => {
                try {
                    const { color, amount } = data;
                    // gameEngine handles the validation (running vs waiting)
                    const bet = await gameEngine.placeBet(user, color, amount);
                    
                    // Optional: You can emit a success message here if needed
                    // socket.emit("bet-success", { message: "Bet placed!", bet });
                } catch (error) {
                    console.error("Bet Error:", error.message);
                    socket.emit("error", { message: error.message });
                }
            });
            socket.on("change-result",async (data)=>{
                try{
                    const {color} = data;
                    await gameEngine.AdminColorWin(color,socket);
                }catch(error){
                    console.error("Admin Color Change Error:", error.message);
                    socket.emit("error", { message: error.message });
                }
            });
            socket.on("change-duration",async (data)=>{
                try{
                    const {seconds,isIncrease} = data;
                    await gameEngine.AdminChangeDuration(seconds,isIncrease,socket);
                }catch(error){      
                    console.error("Admin Duration Change Error:", error.message);
                    socket.emit("error", { message: error.message });
                }
            });
            // 5. Handle Disconnect
            socket.on("disconnect", async () => {
                await gameEngine.leaveGame(user);
                console.log(`User ${user.name} (${userId}) disconnected`);
            });
        });

    } catch (error) {
        console.log("Socket Error:", error.message);
    }
};

// 👉 getter
const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

export { StartIoServer, getIO };