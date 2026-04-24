import mongoose from "mongoose";

const processedTxSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["TATUM", "TRANSAK", "SYSTEM"],
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["DEPOSIT", "WITHDRAW", "SWEEP"],
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    address: {
      type: String,
      default: null,
      index: true,
    },
    amountSun: {
      type: Number,
      default: 0,
      min: 0,
    },
    source: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

processedTxSchema.index(
  { direction: 1, txHash: 1 },
  {
    unique: true,
  }
);

export const ProcessedTx = mongoose.model("ProcessedTx", processedTxSchema);
