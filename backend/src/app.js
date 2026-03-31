import express from "express";
import cors from "cors";    
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";
// app 
export const app = express();

// Middleware

app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({extended:true}));


// Routes

import rampRouter from "./routes/ramp.route.js";
import webhookRouter from "./routes/webhook.route.js";
import walletRouter from "./routes/wallet.route.js";
import userRouter from "./routes/user.route.js";
import adminRouter from "./routes/admin.route.js";

app.get("/health",(req,res)=>{
    res.json({
        status:200,
        message:"Surver is running"
    })
});

// API Routes setup
app.use("/api/v1/users", userRouter);      // endpoints: /api/v1/users/register, /api/v1/users/login, etc.
app.use("/api/v1/admin", adminRouter);     // endpoints: /api/v1/admin/users, /api/v1/admin/leaderboard
app.use("/api/v1/wallet", walletRouter);   // endpoints: /api/v1/wallet
app.use("/api/v1/ramp", rampRouter);       // endpoints: /api/v1/ramp/on-ramp, /api/v1/ramp/off-ramp, /api/v1/ramp/withdraw
app.use("/api/v1/webhook", webhookRouter); // endpoints: /api/v1/webhook/tatum/deposit, /api/v1/webhook/transak, etc.

import { errorHandler } from "./middleware/error.middleware.js";
app.use(errorHandler);
