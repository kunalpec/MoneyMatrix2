import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

// ✅ safe fallback
const rawOrigins =
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_URL ||
  "http://localhost:5173";

// Array of Allowed clients
const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);


// ✅ CORS options
export const corsOptions = {
  origin: (origin, callback) => {
    try {
      // allow requests without origin (Postman, mobile apps)
      if (!origin) return callback(null, true);

      // allow localhost always
      if (origin.includes("localhost")) return callback(null, true);

      // allow ngrok (dynamic URLs)
      if (origin.includes("ngrok")) return callback(null, true);

      // allow from env
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked: ${origin}`));
    } catch (error) {
      return callback(new Error("CORS internal error"));
    }
  },
  credentials: true,
};

