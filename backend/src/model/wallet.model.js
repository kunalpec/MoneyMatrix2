import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceSun: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "balanceSun must be an integer",
      },
    },

    // 🔒 optional: lock balance during bets
    lockedBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedBalanceSun: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "lockedBalanceSun must be an integer",
      },
    },

    address:{
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    xpub:{
        type: String,
        required: true,
        unique: true,
    },
    mnemonic:{
        type: String,
        default: null,
    },
    index:{
        type: Number,
        required: true,
    },
    signatureId: {
      type: String,
      default: null,
      index: true,
    },
    signerProvider: {
      type: String,
      enum: ["TATUM_KMS", "EXTERNAL", null],
      default: null,
    },
    signerRef: {
      type: String,
      default: null,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);


// 💰 Credit (add money)
walletSchema.methods.credit = function (amount) {
  this.balance += amount;
  this.balanceSun += Math.round(amount * 1_000_000);
};


// 💸 Debit (place bet)
walletSchema.methods.debit = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance");
  }
  this.balance -= amount;
  this.balanceSun -= Math.round(amount * 1_000_000);
};


// 🔐 Lock balance (when bet placed but not settled)
walletSchema.methods.lockAmount = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance");
  }

  this.balance -= amount;
  this.balanceSun -= Math.round(amount * 1_000_000);
  this.lockedBalance += amount;
  this.lockedBalanceSun += Math.round(amount * 1_000_000);
};


// 🔓 Unlock + settle win
walletSchema.methods.settleWin = function (betAmount, winAmount,io,userSocket) {
  this.lockedBalance -= betAmount;
  this.lockedBalanceSun -= Math.round(betAmount * 1_000_000);
  this.balance += winAmount;
  this.balanceSun += Math.round(winAmount * 1_000_000);
  // Optional: Emit real-time update to user about wallet change
  if (io && userSocket) {
    io.to(userSocket).emit("wallet-update", {
      balance: this.balance,
      lockedBalance: this.lockedBalance,
    });
  }
};


// ❌ Unlock (lost bet)
walletSchema.methods.settleLoss = function (amount) {
  this.lockedBalance -= amount;
  this.lockedBalanceSun -= Math.round(amount * 1_000_000);
};


export const Wallet = mongoose.model("Wallet", walletSchema);
