import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const rawOrigins =
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_URL ||
  "http://localhost:5173";

const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsOptions = {
  origin: (origin, callback) => {
    try {
      if (!origin) return callback(null, true);

      if (!isProduction && origin.includes("localhost")) {
        return callback(null, true);
      }

      if (!isProduction && origin.includes("ngrok")) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked: ${origin}`));
    } catch {
      return callback(new Error("CORS internal error"));
    }
  },
  credentials: true,
};
