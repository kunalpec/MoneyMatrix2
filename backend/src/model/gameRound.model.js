import mongoose from "mongoose";

const gameRoundSchema = new mongoose.Schema(
  {
    roundId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["waiting", "running", "ended"],
      default: "waiting",
      index: true,
    },

    startTime: {
      type: Date,
      required: true,
    },

    endTime: {
      type: Date,
      required: true,
    },

    result: {
      type: String,
      enum: ["red", "blue", "violet"],
      default: undefined,
    },

    isResultDeclared: {
      type: Boolean,
      default: false,
    },
    isSettled: {
      type: Boolean,
      default: false,
      index: true,
    },

    totalBetAmount: {
      type: Number,
      default: 0,
    },

    // optional: track total per color
    totalRed: {
      type: Number,
      default: 0,
    },

    totalBlue: {
      type: Number,
      default: 0,
    },

    totalViolet: {
      type: Number,
      default: 0,
    },

    // admin control (optional but useful)
    isManualResult: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);


// 🔢 Generate roundId automatically
gameRoundSchema.pre("validate", function () {
  if (!this.roundId) {
    this.roundId = `ROUND-${Date.now()}`;
  }
});


// 🎯 Method: set result
gameRoundSchema.methods.setResult = function () {
  // ✅ If admin already set result → use it
  if (this.isManualResult && this.result) {
    this.isResultDeclared = true;
    return;
  }

  // 🎯 Get totals
  const totals = {
    red: this.totalRed || 0,
    blue: this.totalBlue || 0,
    violet: this.totalViolet || 0,
  };

  // 🧠 Find minimum bet amount
  const minAmount = Math.min(totals.red, totals.blue, totals.violet);

  // 🎯 Get all colors having this minimum (handle tie case)
  const possibleWinners = Object.keys(totals).filter(
    (color) => totals[color] === minAmount
  );

  // ⚡ If tie → pick random from them
  const randomIndex = Math.floor(Math.random() * possibleWinners.length);

  this.result = possibleWinners[randomIndex];

  // ✅ finalize
  this.isResultDeclared = true;
};


// ⏱️ Method: check if round expired
gameRoundSchema.methods.isExpired = function () {
  return new Date() > this.endTime;
};


export const GameRound = mongoose.model("GameRound", gameRoundSchema);
