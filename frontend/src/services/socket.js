import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socketInstance = null;

export const connectAdminSocket = (token) => {
  if (!token) {
    return null;
  }

  if (socketInstance) {
    socketInstance.auth = { token };

    if (!socketInstance.connected) {
      socketInstance.connect();
    }

    return socketInstance;
  }

  socketInstance = io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  return socketInstance;
};

export const getAdminSocket = () => socketInstance;

export const disconnectAdminSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
};
