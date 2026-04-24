import mongoose from "mongoose";
import { getIO } from "../socket/index.js";
import { GameRound } from "../model/gameRound.model.js";
import { Bet } from "../model/bet.model.js";
import { Wallet } from "../model/wallet.model.js";
import { ApiError } from "../util/ApiError.util.js";

const MAX_BET_TRANSACTION_RETRIES = 3;

const isRetryableTransactionError = (error) => {
    if (!error) return false;

    if (typeof error.hasErrorLabel === "function") {
        return (
            error.hasErrorLabel("TransientTransactionError") ||
            error.hasErrorLabel("UnknownTransactionCommitResult")
        );
    }

    return /write conflict|transienttransactionerror|unknowntransactioncommitresult/i.test(
        String(error.message || "")
    );
};

class GameEngine {
    constructor() {
        this.io = null;
        this.adminRoom = "admin-room";
        this.usersRooms = new Map();
        this.connectedUsers = new Map();
        this.currentRound = null;
        this.roundDuration = 60 * 1000;
        this.interval = null;
        this.resultDuration = 60 * 1000;
        this.activeBetLocks = new Set();
    }

    async init() {
        this.io = getIO();
        console.log("GameEngine initialized");
    }

    sendEventToAdmin(event, data) {
        if (this.io) {
            this.io.to(this.adminRoom).emit(event, data);
        }
    }

    sendEventToUser(userId, event, data) {
        const socketId = this.usersRooms.get(userId.toString());
        if (socketId && this.io) {
            this.io.to(socketId).emit(event, data);
        }
    }

    sendEventToAllUsers(event, data) {
        if (this.io) {
            this.io.emit(event, data);
        }
    }

    getLivePlayerCount() {
        return Array.from(this.connectedUsers.values()).filter(
            (entry) => entry?.role !== "admin"
        ).length;
    }

    async joinGame(user, socket) {
        const userId = user._id.toString();
        const previousSocketId = this.usersRooms.get(userId);

        if (previousSocketId && previousSocketId !== socket.id && this.io) {
            this.io.sockets.sockets.get(previousSocketId)?.disconnect(true);
        }

        this.usersRooms.set(userId, socket.id);
        this.connectedUsers.set(userId, {
            socketId: socket.id,
            role: user.role,
        });
        socket.join(userId);

        if (user.role === "admin") {
            socket.join(this.adminRoom);
            console.log(`Admin joined: ${user._id}`);
        } else {
            console.log(`User joined: ${user._id}`);
        }

        if (this.currentRound) {
            const walletSnapshot = await Wallet.findOne({ user: user._id })
                .select("trxBalanceSun trxLockedBalanceSun")
                .lean();
            this.sendEventToAdmin("player-count", this.getLivePlayerCount());
            this.sendEventToUser(user._id, "current-round", this.currentRound);
            this.sendEventToUser(user._id, "curret-wallet", {
                ...walletSnapshot,
                trxBalance: (walletSnapshot?.trxBalanceSun || 0) / 1_000_000,
                trxLockedBalance:
                    (walletSnapshot?.trxLockedBalanceSun || 0) / 1_000_000,
            });
        }
    }

    async leaveGame(user, socket = null) {
        const userId = user._id.toString();
        const currentSocketId = this.usersRooms.get(userId);

        if (socket && currentSocketId && currentSocketId !== socket.id) {
            return;
        }

        this.usersRooms.delete(userId);
        this.connectedUsers.delete(userId);
        this.sendEventToAdmin("player-count", this.getLivePlayerCount());
        console.log(`User left: ${user._id}`);
    }

    async startGame() {
        console.log("Game Engine Loop Started");
        await this.createGame();
        console.log("phase: game is create and running");
        this.interval = setInterval(() => {
            this.tick();
        }, 1000);
    }

    async createGame() {
        if (this.currentRound) {
            await this.endGame();
        }
        this.currentRound = await GameRound.create({
            startTime: new Date(),
            endTime: new Date(Date.now() + this.roundDuration),
            status: "running",
            result: undefined,
            isManualResult: false,
            isResultDeclared: false,
            totalBetAmount: 0,
            totalRed: 0,
            totalBlue: 0,
            totalViolet: 0,
        });

        this.sendEventToAllUsers("new-round", this.currentRound);
    }

    async tick() {
        if (!this.currentRound) return;

        const now = new Date();
        const remaining = Math.max(0, this.currentRound.endTime - now);

        this.sendEventToAllUsers("timer", {
            remaining,
            status: this.currentRound.status
        });

        if (now >= this.currentRound.endTime) {
            if (this.currentRound.status === "running") {
                await this.endGame();
            } else if (this.currentRound.status === "waiting") {
                await this.createGame();
            }
        }
    }

    async endGame() {
        if (!this.currentRound) return;

        if (this.currentRound.status === "waiting") {
            console.log("phase: game is ended");
            this.sendEventToAllUsers("round-ended", {
                result: this.currentRound.result,
                status: "ended",
            });
            this.currentRound.status = "ended";
            await this.currentRound.save({ validateBeforeSave: false });
            return;
        }
        const settlementNotifications = [];
        let settledRound = null;
        const session = await mongoose.startSession();

        try {
            await session.withTransaction(async () => {
                const round = await GameRound.findById(this.currentRound._id).session(session);

                if (!round) {
                    throw new ApiError(404, "Round not found for settlement");
                }

                if (round.isSettled) {
                    settledRound = round;
                    return;
                }

                round.setResult();
                round.status = "waiting";
                round.endTime = new Date(Date.now() + this.resultDuration);
                round.isSettled = true;
                await round.save({ session });

                const bets = await Bet.find({
                    round: round._id,
                    status: "pending",
                }).session(session);

                for (const bet of bets) {
                    bet.calculateWin(round.result);
                    await bet.save({ session });

                    const wallet = await Wallet.findOne({ user: bet.user }).session(session);
                    if (!wallet) {
                        continue;
                    }

                    if (bet.status === "won") {
                        wallet.settleWin(bet.amount, bet.winAmount);
                    } else {
                        wallet.settleLoss(bet.amount);
                    }

                    await wallet.save({ session });

                    settlementNotifications.push({
                        userId: bet.user.toString(),
                        bet: bet.toObject(),
                        wallet: {
                            trxBalance: wallet.trxBalance,
                            trxLockedBalance: wallet.trxLockedBalance,
                        },
                    });
                }

                settledRound = round;
            });
        } catch (error) {
            console.error("ROUND_SETTLEMENT_FAILED", {
                roundId: this.currentRound?._id?.toString?.(),
                error: error?.message,
            });
            throw error;
        } finally {
            await session.endSession();
        }

        if (settledRound) {
            if (typeof settledRound.$session === "function") {
                settledRound.$session(null);
            }
            this.currentRound = settledRound;
        }

        for (const notification of settlementNotifications) {
            this.sendEventToUser(notification.userId, "wallet-update", notification.wallet);
            this.sendEventToUser(notification.userId, "bet-result", notification.bet);
        }

        this.sendEventToAllUsers("round-ended", {
            result: this.currentRound.result,
            status: "waiting",
            nextRoundAt: this.currentRound.endTime,
            currentRound: this.currentRound
        });

        console.log("phase: waiting-", this.currentRound.result, "show for 1 minute");
    }

    async placeBet(user, color, amount) {
        if (user.role === "admin") {
            throw new ApiError(403, "Admins cannot place bets");
        }

        if (!this.currentRound || this.currentRound.status !== "running") {
            throw new ApiError(400, "Betting is currently closed");
        }

        if (new Date() > this.currentRound.endTime) {
            throw new ApiError(400, "Betting phase has ended");
        }

        const validColors = ["red", "blue", "violet"];
        if (!validColors.includes(color)) {
            throw new ApiError(400, "Invalid color selected");
        }

        if (amount <= 0) {
            throw new ApiError(400, "Bet amount must be greater than 0");
        }

        const betLockKey = `${user._id}:${this.currentRound._id}`;

        if (this.activeBetLocks.has(betLockKey)) {
            throw new ApiError(429, "Bet is already being processed");
        }

        this.activeBetLocks.add(betLockKey);

        try {
            for (let attempt = 1; attempt <= MAX_BET_TRANSACTION_RETRIES; attempt += 1) {
                const session = await mongoose.startSession();

                try {
                    session.startTransaction();

                    const wallet = await Wallet.findOne({ user: user._id }).session(session);
                    if (!wallet) {
                        throw new ApiError(404, "Wallet not found");
                    }

                    wallet.lock(amount);
                    await wallet.save({ session });

                    const betArray = await Bet.create([{
                        user: user._id,
                        round: this.currentRound._id,
                        color,
                        amount,
                    }], { session });
                    const bet = betArray[0];

                    const round = await GameRound.findById(this.currentRound._id).session(session);
                    if (!round || round.status !== "running") {
                        throw new ApiError(400, "Round is no longer accepting bets");
                    }

                    round.totalBetAmount += amount;
                    if (color === "red") round.totalRed += amount;
                    if (color === "blue") round.totalBlue += amount;
                    if (color === "violet") round.totalViolet += amount;

                    await round.save({ session });
                    await session.commitTransaction();

                    this.currentRound = round;

                    this.sendEventToUser(user._id, "bet-placed", {
                        bet,
                        trxBalance: wallet.trxBalance,
                        trxLockedBalance: wallet.trxLockedBalance,
                    });

                    this.sendEventToAdmin("admin-bet-update", {
                        userId: user._id,
                        amount,
                        color,
                        roundId: this.currentRound._id,
                        currentTotals: {
                            total: round.totalBetAmount,
                            red: round.totalRed,
                            blue: round.totalBlue,
                            violet: round.totalViolet
                        }
                    });

                    return bet;
                } catch (error) {
                    if (session.inTransaction()) {
                        await session.abortTransaction();
                    }

                    if (isRetryableTransactionError(error) && attempt < MAX_BET_TRANSACTION_RETRIES) {
                        console.warn(
                            `Bet transaction write conflict, retrying attempt ${attempt + 1}/${MAX_BET_TRANSACTION_RETRIES}`
                        );
                        continue;
                    }

                    console.error("Bet Transaction Failed:", error.message);

                    if (error instanceof ApiError) throw error;

                    if (isRetryableTransactionError(error)) {
                        throw new ApiError(503, "Bet is busy right now, please retry");
                    }

                    throw new ApiError(400, error.message || "Failed to place bet");
                } finally {
                    session.endSession();
                }
            }
        } finally {
            this.activeBetLocks.delete(betLockKey);
        }
    }

    async AdminColorWin(color, socket) {
        if (socket.user.role !== "admin") {
            throw new ApiError(403, "Unauthorized: Only admins can change the result");
        }
        if (!this.currentRound || this.currentRound.status !== "running") {
            throw new ApiError(400, "Cannot set result now");
        }
        const validColors = ["red", "blue", "violet"];
        if (!validColors.includes(color)) {
            throw new ApiError(400, "Invalid result color");
        }
        this.currentRound.result = color;
        this.currentRound.isManualResult = true;
        this.currentRound.isResultDeclared = false;
        await this.currentRound.save();
        this.sendEventToAdmin("admin-set-result", {
            result: color,
            roundId: this.currentRound._id,
            currentRound: this.currentRound,
            action: "queued"
        });
    }

    async AdminChangeDuration(seconds, isIncrease = true, socket) {
        if (socket.user.role !== "admin") {
            throw new ApiError(403, "Unauthorized: Only admins can change the result");
        }
        if (!this.currentRound || this.currentRound.status !== "running") {
            throw new ApiError(400, "Cannot change duration now");
        }
        const durationMs = Number(seconds) * 1000;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            throw new ApiError(400, "Seconds must be greater than 0");
        }
        this.currentRound.endTime = isIncrease
            ? new Date(this.currentRound.endTime.getTime() + durationMs)
            : new Date(Math.max(Date.now() + 1000, this.currentRound.endTime.getTime() - durationMs));
        await this.currentRound.save();
        this.sendEventToAllUsers("admin-change-duration", {
            newEndTime: this.currentRound.endTime,
            roundId: this.currentRound._id,
            currentRound: this.currentRound
        });
    }

    async stopGame() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.currentRound = null;
        this.sendEventToAllUsers("game-stopped", {});
        for (const userId of this.usersRooms.keys()) {
            const currBet = await Bet.findOne({ user: userId, status: "pending" });
            if (currBet) {
                currBet.status = "lost";
                await currBet.save();
            }
        }
        this.connectedUsers.clear();
        console.log("Game Engine Loop Stopped");
    }
}

export const gameEngine = new GameEngine();
