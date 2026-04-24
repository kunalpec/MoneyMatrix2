import mongoose from "mongoose";
import { Wallet } from "../model/wallet.model.js";
import { Bet } from "../model/bet.model.js";
import { AsyncHandler } from "../util/AsyncHandler.util.js";
import { ApiError } from "../util/ApiError.util.js";
import { ApiResponse } from "../util/ApiResponse.util.js";

export const walletInfo = AsyncHandler(async (req, res) => {
    // req.user is attached by verifyJWT middleware. No need to query User again.
    const wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
        throw new ApiError(404, "Wallet not found");
    }
    return res.status(200).json(
        new ApiResponse(200, {
            wallet: {
                address: wallet.address,
                trxBalanceSun: wallet.trxBalanceSun,
                trxBalance: wallet.trxBalance,
                trxLockedBalanceSun: wallet.trxLockedBalanceSun,
                trxLockedBalance: wallet.trxLockedBalance,
            },
        }, "Wallet information retrieved successfully")
    );
});

export const getbetInfo = AsyncHandler(async (req, res) => {
    // req.user is attached by verifyJWT middleware.
    const userId = req.user._id;

    const betInfoResult = await Bet.aggregate([
        {
            $match: {
                user: userId, // Match by user's ObjectId
            },
        },
        {
            $group: {
                _id: "$user", // Group by user ID
                totalBets: { $sum: 1 },
                totalAmountBet: { $sum: "$amount" },
                totalWins: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                totalLosses: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
                totalAmountWon: { $sum: { $cond: [{ $eq: ["$status", "won"] }, "$winAmount", 0] } },
                totalAmountLost: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, "$amount", 0] } },
            },
        },
    ]);

    // Aggregation returns an array. If user has no bets, it's empty.
    const betInfo = betInfoResult[0] || {
        _id: userId,
        totalBets: 0,
        totalAmountBet: 0,
        totalWins: 0,
        totalLosses: 0,
        totalAmountWon: 0,
        totalAmountLost: 0,
    };

    return res.status(200).json(
        new ApiResponse(200, { betInfo }, "Bet information retrieved successfully")
    );
});
