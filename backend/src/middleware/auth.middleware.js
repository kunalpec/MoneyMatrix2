import jwt from "jsonwebtoken";
import { User } from "../model/user.model.js";
import { ApiError } from "../util/ApiError.util.js";
import { AsyncHandler } from "../util/AsyncHandler.util.js";

export const verifyJWT = AsyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const accessSecret = process.env.ACCESS_TOKEN_SECRET;
    const cookieHeader = req.headers.cookie;

    const accessTokenFromCookieHeader = cookieHeader
        ?.split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith("accessToken="))
        ?.split("=")[1];

    const token =
        req.cookies?.accessToken ||
        accessTokenFromCookieHeader ||
        (authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

    console.log("Extracted Token:", token); 
    if (!token) {
        throw new ApiError(401, "Unauthorized");
    }

    let decoded;
    try {
        decoded = jwt.verify(token, accessSecret);
    } catch {
        throw new ApiError(401, "Invalid or expired token");
    }

    if (!decoded?._id) {
        throw new ApiError(401, "Invalid user token");
    }

    const user = await User.findById(decoded._id).select(
        "-password -refreshToken"
    );

    if (!user) {
        throw new ApiError(401, "User not found");
    }

    req.user = user;
    next();
});

export const requireRole = (...roles) => {
    return AsyncHandler(async (req, res, next) => {
        if (!req.user) {
            throw new ApiError(401, "Unauthorized");
        }

        if (!roles.includes(req.user.role)) {
            throw new ApiError(403, "Forbidden");
        }

        next();
    });
};
