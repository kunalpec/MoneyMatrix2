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

    // 🔒 optional: lock balance during bets
    lockedBalance: {
      type: Number,
      default: 0,
      min: 0,
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
        required: true,
        unique: true,
    },
    index:{
        type: Number,
        required: true,
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
};


// 💸 Debit (place bet)
walletSchema.methods.debit = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance");
  }
  this.balance -= amount;
};


// 🔐 Lock balance (when bet placed but not settled)
walletSchema.methods.lockAmount = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance");
  }

  this.balance -= amount;
  this.lockedBalance += amount;
};


// 🔓 Unlock + settle win
walletSchema.methods.settleWin = function (betAmount, winAmount) {
  this.lockedBalance -= betAmount;
  this.balance += winAmount;
};


// ❌ Unlock (lost bet)
walletSchema.methods.settleLoss = function (amount) {
  this.lockedBalance -= amount;
};


export const Wallet = mongoose.model("Wallet", walletSchema);