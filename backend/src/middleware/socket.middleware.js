import jwt from "jsonwebtoken";
import { User } from "../model/user.model.js";
import { ApiError } from "../util/ApiError.util.js";

export const socketAuthMiddleware = async (socket, next) => {
  try {
    // 🔐 get token
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(" ")[1];

    if (!token) {
      return next(new ApiError(401, "Token missing"));
    }

    // ✅ verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
      return next(new ApiError(401, "Invalid token"));
    }

    // 🔍 find user
    const user = await User.findById(decoded._id).select("-password");

    if (!user) {
      return next(new ApiError(404, "User not found"));
    }

    // 💾 attach user
    socket.user = user;

    next(); // ✅ success
  } catch (error) {
    return next(new ApiError(500, "Socket authentication failed"));
  }
};