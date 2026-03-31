import { ApiError } from "../util/ApiError.util.js";

export const errorHandler = (err, req, res, next) => {
  let error = err;

  // अगर normal error है → convert to ApiError
  if (!(error instanceof ApiError)) {
    error = new ApiError(
      error.statusCode || 500,
      error.message || "Internal Server Error"
    );
  }

  // If headers were already sent, we must delegate to the default Express error handler
  if (res.headersSent) {
    if (typeof next === "function") {
      return next(error);
    }

    return;
  }

  // 🔥 response format
  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    statusCode: error.statusCode,
    stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
  });
};
