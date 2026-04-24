import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";

import adminRouter from "./routes/admin.route.js";
import rampRouter from "./routes/ramp.route.js";
import transakRouter from "./routes/transak.route.js";
import userRouter from "./routes/user.route.js";
import walletRouter from "./routes/wallet.route.js";
import webhookRouter from "./routes/webhook.route.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { verifyJWT } from "./middleware/auth.middleware.js";
import { getCurrentUser } from "./controller/auth.controller.js";

export const app = express();

app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(cookieParser());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({
    status: 200,
    message: "Server is running",
  });
});

app.use("/api/v1/users", userRouter);
app.get("/api/v1/auth/me", verifyJWT, getCurrentUser);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/wallet", walletRouter);
app.use("/api/v1/ramp", rampRouter);
app.use("/api/v1/webhook", webhookRouter);
app.use("/api/v1/transak", transakRouter);

app.use(errorHandler);
