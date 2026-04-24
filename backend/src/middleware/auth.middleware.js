import jwt from "jsonwebtoken";
import { User } from "../model/user.model.js";
import { ApiError } from "../util/ApiError.util.js";
import { AsyncHandler } from "../util/AsyncHandler.util.js";

const cleanToken = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const token = value.trim().replace(/^Bearer\s+/i, "").replace(/^"+|"+$/g, "");
  return token || null;
};

export const verifyJWT = AsyncHandler(async (req, res, next) => {
  const tokenCandidates = [
    cleanToken(req.headers.token),
    cleanToken(req.headers.authorization),
    cleanToken(req.headers["x-access-token"]),
    cleanToken(req.cookies?.accessToken),
    cleanToken(req.body?.accessToken),
    cleanToken(req.body?.token),
    cleanToken(req.query?.accessToken),
    cleanToken(req.query?.token),
  ].filter(Boolean);

  if (tokenCandidates.length === 0) {
    throw new ApiError(401, "Unauthorized");
  }

  let decoded;

  for (const token of tokenCandidates) {
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      break;
    } catch {
      decoded = null;
    }
  }

  if (!decoded) {
    throw new ApiError(401, "Invalid or expired token");
  }

  const user = await User.findById(decoded?._id).select("-password -refreshToken");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  req.user = user;
  next();
});

export const requireRole = (...roles) =>
  AsyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, "Forbidden");
    }

    next();
  });
