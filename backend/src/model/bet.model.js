import mongoose from "mongoose";

const betSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    round: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameRound",
      required: true,
      index: true,
    },

    color: {
      type: String,
      enum: ["red", "blue", "violet"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      enum: ["pending", "won", "lost"],
      default: "pending",
      index: true,
    },

    winAmount: {
      type: Number,
      default: 0,
    },

    isSettled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);


// ✅ Prevent duplicate same bet (optional but useful)
betSchema.index({ user: 1, round: 1, color: 1 }, { unique: false });


// 🎯 Instance method: calculate win
betSchema.methods.calculateWin = function (resultColor) {
  if (this.color === resultColor) {
    let multiplier = 2;
    this.status = "won";
    this.winAmount = this.amount * multiplier;
  } else {
    this.status = "lost";
    this.winAmount = 0;
  }
  this.isSettled = true;
};


export const Bet = mongoose.model("Bet", betSchema);