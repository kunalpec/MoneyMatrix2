import { User } from "../model/user.model.js";
import { Bet } from "../model/bet.model.js";
import { Wallet } from "../model/wallet.model.js";
import { AsyncHandler } from "../util/AsyncHandler.util.js";
import { ApiResponse } from "../util/ApiResponse.util.js";
import { gameEngine } from "../service/gameEngine.service.js";
import { ApiError } from "../util/ApiError.util.js";

/**
 * @desc    Get all users & currently active users on the platform
 * @route   GET /api/v1/admin/users
 */
export const getPlatformUsers = AsyncHandler(async (req, res) => {
  // 1. Get all active socket user IDs from the game engine
  if(req.user.role!=="admin"){
    throw new ApiError(401,"Unauthorized to get this data");
  }
  const activeSocketUserIds = Array.from(gameEngine.usersRooms.keys());

  // 2. Fetch all users and their wallet balances using aggregation
  const allUsers = await User.aggregate([
    { $match: { role: "user" } }, // Only fetch regular users
    {
      $lookup: {
        from: "wallets", // Mongoose pluralizes "Wallet" to "wallets"
        localField: "_id",
        foreignField: "user",
        as: "walletData",
      },
    },
    {
      $unwind: {
        path: "$walletData",
        preserveNullAndEmptyArrays: true, // Keep users even if they don't have a wallet yet
      },
    },
    {
      $project: {
        name: 1,
        email: 1,
        phone: 1,
        tronAddress: 1,
        createdAt: 1,
        trxBalanceSun: { $ifNull: ["$walletData.trxBalanceSun", 0] },
        trxLockedBalanceSun: { $ifNull: ["$walletData.trxLockedBalanceSun", 0] },
        trxBalance: {
          $divide: [{ $ifNull: ["$walletData.trxBalanceSun", 0] }, 1_000_000],
        },
        trxLockedBalance: {
          $divide: [{ $ifNull: ["$walletData.trxLockedBalanceSun", 0] }, 1_000_000],
        },
        // If they have a refresh token, they have an active login session
        isLoggedIn: { $cond: [{ $ifNull: ["$refreshToken", false] }, true, false] },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  // 3. Mark users who are currently connected to the game sockets
  const usersWithLiveStatus = allUsers.map((user) => ({
    ...user,
    isCurrentlyPlaying: activeSocketUserIds.includes(user._id.toString()),
  }));

  return res.status(200).json(
    new ApiResponse(200, {
      totalUsers: usersWithLiveStatus.length,
      livePlayers: usersWithLiveStatus.filter((user) => user.isCurrentlyPlaying).length,
      users: usersWithLiveStatus,
    }, "Platform users fetched successfully")
  );
});

/**
 * @desc    Get top users with the maximum win amounts (Leaderboard)
 * @route   GET /api/v1/admin/leaderboard
 */
export const getLeaderboard = AsyncHandler(async (req, res) => {
    if(req.user.role!=="admin"){
    throw new ApiError(401,"Unauthorized to get this data");
  }
  const limit = parseInt(req.query.limit) || 10;

  const leaderboard = await Bet.aggregate([
    // 1. Only look at won bets
    { $match: { status: "won" } },
    // 2. Group by user, summing up their total winnings and counting their winning bets
    {
      $group: {
        _id: "$user",   // group by user id 
        totalWinAmount: { $sum: "$winAmount" },
        totalBetsWon: { $sum: 1 },
      },
    },
    // 3. Sort by highest total win amount first
    { $sort: { totalWinAmount: -1 } },
    // 4. Limit to top N players
    { $limit: limit },
    // 5. Look up the user's actual details from the User collection
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userInfo" } },
    { $unwind: "$userInfo" },
    // 6. Format the output
    {
      $project: {
        _id: 1,
        totalWinAmount: 1,
        totalBetsWon: 1,
        name: "$userInfo.name",
        email: "$userInfo.email",
        tronAddress: "$userInfo.tronAddress",
      },
    },
  ]);

  return res.status(200).json(
    new ApiResponse(200, leaderboard, "Leaderboard fetched successfully")
  );
});

/**
 * @desc    Get admin wallet summary
 * @route   GET /api/v1/admin/wallet
 */
export const getAdminWalletSummary = AsyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    throw new ApiError(401, "Unauthorized to get this data");
  }

  const adminWallet = await Wallet.findOne({ isAdmin: true }).select(
    "address trxBalanceSun trxLockedBalanceSun isAdmin"
  );

  if (!adminWallet) {
    throw new ApiError(404, "Admin wallet not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        address: adminWallet.address,
        trxBalanceSun: adminWallet.trxBalanceSun || 0,
        trxLockedBalanceSun: adminWallet.trxLockedBalanceSun || 0,
        trxBalance: adminWallet.trxBalance || 0,
        trxLockedBalance: adminWallet.trxLockedBalance || 0,
        currency: "TRX",
      },
      "Admin wallet fetched successfully"
    )
  );
});
