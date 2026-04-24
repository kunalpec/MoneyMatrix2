import jwt from "jsonwebtoken";
import { User } from "../model/user.model.js";
import { ApiError } from "../util/ApiError.util.js";

const getSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  const header = socket.handshake.headers?.authorization;

  if (authToken) {
    return authToken;
  }

  if (header?.startsWith("Bearer ")) {
    return header.split(" ")[1];
  }

  return null;
};

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const token = getSocketToken(socket);

    if (!token) {
      return next(new ApiError(401, "Socket token missing"));
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    if (!decoded?._id) {
      return next(new ApiError(401, "Invalid socket token"));
    }

    const user = await User.findById(decoded._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      return next(new ApiError(401, "Socket user not found"));
    }

    socket.user = user;
    return next();
  } catch (error) {
    return next(new ApiError(401, "Socket authentication failed"));
  }
};
