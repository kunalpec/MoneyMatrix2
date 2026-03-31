import mongoose from "mongoose";
import { getIO } from "../socket/index.js";
import { GameRound } from "../model/gameRound.model.js";
import { Bet } from "../model/bet.model.js";
import { Wallet } from "../model/wallet.model.js";
import { ApiError } from "../util/ApiError.util.js";

class GameEngine {
    constructor() {
        this.io = null;
        this.adminRoom = "admin-room";
        this.usersRooms = new Map(); // userId -> socketId
        this.currentRound = null;
        this.roundDuration = 60 * 1000; // 1 min
        this.interval = null;
        this.resultDuration = 60 * 1000;   // 1 min to show result/wait
    }

    // 🔥 Initialize Socket
    async init() {
        this.io = getIO();
        console.log("✅ GameEngine initialized");
    }

    // 🔌 ================= SOCKET HELPERS =================

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

    // 👤 ================= USER JOIN/LEAVE =================

    async joinGame(user, socket) {
        // Map userId to socketId for private messaging
        this.usersRooms.set(user._id.toString(), socket.id);

        // 1. Every user joins their own private room
        socket.join(user._id.toString());

        // 2. 🔐 Check role: If Admin, join the admin room
        if (user.role === "admin") {
            socket.join(this.adminRoom);
            console.log(`👑 Admin joined: ${user._id}`);
        } else {
            console.log(`👤 User joined: ${user._id}`);
        }

        // Send current game state to the joining user
        if (this.currentRound) {
            this.sendEventToAdmin("player-count", this.usersRooms.size);
            this.sendEventToUser(user._id, "current-round", this.currentRound);
        }
    }

    async leaveGame(user) {
        this.usersRooms.delete(user._id.toString());
        this.sendEventToAdmin("player-count", this.usersRooms.size);
        console.log(`User left: ${user._id}`);
    }

    // 🚀 ================= GAME LIFECYCLE =================

    async startGame() {
        console.log("🎮 Game Engine Loop Started");
        await this.createGame();
        console.log("phase: game is create and running");
        // Standard 1-second tick for the timer
        this.interval = setInterval(() => {
            this.tick();
        }, 1000);

    }

    async createGame() {
        // Create new round using your Schema
        if (this.currentRound) {
            await this.endGame();
        }
        this.currentRound = await GameRound.create({
            startTime: new Date(),
            endTime: new Date(Date.now() + this.roundDuration),
            status: "running",
        });

        this.sendEventToAllUsers("new-round", this.currentRound);
    }

    async tick() {
        if (!this.currentRound) return;

        const now = new Date();
        const remaining = Math.max(0, this.currentRound.endTime - now);

        // Sync timer with all clients
        this.sendEventToAllUsers("timer", {
            remaining,
            status: this.currentRound.status
        });

        // Toggle Phases when time is up
        if (now >= this.currentRound.endTime) {
            if (this.currentRound.status === "running") {
                // Time up for betting -> Go to Results
                await this.endGame();
            } else if (this.currentRound.status === "waiting") {
                // Time up for results -> Go to New Game
                await this.createGame();
            }
        }
    }

    // 🛑 ================= END ROUND & SETTLE =================

    async endGame() {
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
        if (!this.currentRound) return;

        // 🎯 1. Calculate result and switch status to waiting
        this.currentRound.setResult();
        this.currentRound.status = "waiting";
        // Extend endTime to cover the 1-minute result display phase
        this.currentRound.endTime = new Date(Date.now() + this.resultDuration);
        await this.currentRound.save();


        // 💰 2. Find all pending bets for this round
        const bets = await Bet.find({
            round: this.currentRound._id,
            status: "pending",
        });

        // 💸 3. Settle each bet individually
        for (const bet of bets) {
            bet.calculateWin(this.currentRound.result);
            await bet.save();

            const wallet = await Wallet.findOne({ user: bet.user });
            if (!wallet) continue;

            // Settle based on "won" or "lost" status set by calculateWin()
            if (bet.status === "won") {
                wallet.settleWin(bet.amount, bet.winAmount);
            } else {
                wallet.settleLoss(bet.amount);
            }

            await wallet.save();

            // Notify the specific user of their result
            this.sendEventToUser(bet.user, "bet-result", bet);
        }

        // 📢 4. Notify everyone that the betting is over and show results
        this.sendEventToAllUsers("round-ended", {
            result: this.currentRound.result,
            status: "waiting",
            nextRoundAt: this.currentRound.endTime,
            currentRound: this.currentRound
        });

        console.log("phase: waiting-", this.currentRound.result, "show for 1 minute");
    }

    // 💰 ================= PLACE BET (TRANSACTION) ================

    async placeBet(user, color, amount) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // 🛑 1. Validation Logic
            if (user.role === "admin") {
                throw new ApiError(403, "Admins cannot place bets");
            }

            // ONLY allow betting if status is "running"
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

            // 🔍 2. Wallet & Lock Amount
            const wallet = await Wallet.findOne({ user: user._id }).session(session);
            if (!wallet) {
                throw new ApiError(404, "Wallet not found");
            }

            // Calls your schema method to move balance -> lockedBalance
            wallet.lockAmount(amount);
            await wallet.save({ session });

            // 📝 3. Create Bet Record
            const betArray = await Bet.create([{
                user: user._id,
                round: this.currentRound._id,
                color,
                amount,
            }], { session });
            const bet = betArray[0];

            // 📊 4. Update GameRound Totals (Sync DB first)
            const round = await GameRound.findById(this.currentRound._id).session(session);
            round.totalBetAmount += amount;

            if (color === "red") round.totalRed += amount;
            if (color === "blue") round.totalBlue += amount;
            if (color === "violet") round.totalViolet += amount;

            await round.save({ session });

            // 5. Update Local Engine State
            this.currentRound = round;

            // ✅ COMMIT ALL CHANGES
            await session.commitTransaction();

            // 🔔 6. Notify Client & Admin
            this.sendEventToUser(user._id, "bet-placed", {
                bet,
                balance: wallet.balance,
                lockedBalance: wallet.lockedBalance,
            });

            // Send full update to Admin Room
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
            // ❌ ROLLBACK ON ERROR
            await session.abortTransaction();
            console.error("Bet Transaction Failed:", error.message);

            if (error instanceof ApiError) throw error;
            throw new ApiError(400, error.message || "Failed to place bet");
        } finally {
            // 🔚 End session regardless of outcome
            session.endSession();
        }
    }

    async AdminColorWin(color, socket) {
        if (socket.user.role !== "admin") {
            throw new ApiError(403, "Unauthorized: Only admins can change the result");
        }
        if (!this.currentRound || this.currentRound.status !== "running") {
            throw new ApiError(400, "Cannot set result now");
        }
        this.currentRound.result = color;
        await this.currentRound.save();
        // Immediately end the round to show results
        await this.endGame();
        this.sendEventToAdmin("admin-set-result", {
            result: color,
            roundId: this.currentRound._id
        });
    }

    async AdminChangeDuration(seconds, isIncrease = true, socket) {
        if (socket.user.role !== "admin") {
            throw new ApiError(403, "Unauthorized: Only admins can change the result");
        }
        if (!this.currentRound || this.currentRound.status !== "running") {
            throw new ApiError(400, "Cannot change duration now");
        }
        if (isIncrease) {
            this.currentRound.endTime = new Date(this.currentRound.endTime.getTime() + seconds * 1000);
        } else {
            this.currentRound.endTime = new Date(this.currentRound.endTime.getTime() - seconds * 1000);
        }
        await this.currentRound.save();
        this.sendEventToAllUsers("admin-change-duration", {
            newEndTime: this.currentRound.endTime,
            roundId: this.currentRound._id
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
        console.log("🛑 Game Engine Loop Stopped");
    }

}

export const gameEngine = new GameEngine();