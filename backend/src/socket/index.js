import { Server } from "socket.io";
import { corsOptions } from "../config/cors.js";
import { socketAuthMiddleware } from "../middleware/socket.middleware.js";
import { gameEngine } from "../service/gameEngine.service.js";

let io;

const emitSocketError = (socket, error) => {
  const message = error?.message || "Socket request failed";
  socket.emit("error", { message });
};

const registerGameHandlers = (socket, user) => {
  socket.on("place-bet", async (data = {}) => {
    try {
      const { color, amount } = data;
      await gameEngine.placeBet(user, color, amount);
    } catch (error) {
      emitSocketError(socket, error);
    }
  });

  socket.on("change-result", async (data = {}) => {
    try {
      const { color } = data;
      await gameEngine.AdminColorWin(color, socket);
    } catch (error) {
      emitSocketError(socket, error);
    }
  });

  socket.on("change-duration", async (data = {}) => {
    try {
      const { seconds, isIncrease } = data;
      await gameEngine.AdminChangeDuration(seconds, isIncrease, socket);
    } catch (error) {
      emitSocketError(socket, error);
    }
  });
};

const handleConnection = async (socket) => {
  const user = socket.user;

  if (!user?._id) {
    socket.disconnect(true);
    return;
  }

  await gameEngine.joinGame(user, socket);
  registerGameHandlers(socket, user);

  socket.on("disconnect", async () => {
    await gameEngine.leaveGame(user, socket);
  });
};

const StartIoServer = (server) => {
  if (io) {
    return io;
  }

  io = new Server(server, { cors: corsOptions });
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    handleConnection(socket).catch((error) => {
      emitSocketError(socket, error);
      socket.disconnect(true);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }

  return io;
};

export { StartIoServer, getIO };
