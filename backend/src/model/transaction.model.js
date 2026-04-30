import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    type: {
      type: String,
      enum: ["DEPOSIT", "WITHDRAW", "SWEEP"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    amountSun: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "amountSun must be an integer",
      },
    },
    fee: {
      type: Number,
      default: null,
      min: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "LOCKED", "PROCESSING", "SUCCESS", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    provider: {
      type: String,
      enum: ["TRANSAK", "TATUM", "SYSTEM", null],
      default: null,
      index: true,
    },
    currency: {
      type: String,
      enum: ["TRX", "TRC20", "TRON", "USDT", "USDC", null],
      default: "TRX",
    },
    txId: {
      type: String,
      default: null,
      trim: true,
    },
    externalId: {
      type: String,
      default: null,
      trim: true,
    },
    providerOrderId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    fromAddress: {
      type: String,
      default: null,
      trim: true,
    },
    toAddress: {
      type: String,
      default: null,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastError: {
      type: String,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: "transactions",
    timestamps: true,
    minimize: false,
  }
);

transactionSchema.index(
  { externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalId: { $exists: true, $type: "string" },
    },
  }
);

transactionSchema.index(
  { txId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      txId: { $exists: true, $type: "string" },
    },
  }
);

transactionSchema.index({ userId: 1, type: 1, status: 1 });
transactionSchema.index({ externalId: 1, provider: 1 });
transactionSchema.index({ txId: 1, type: 1 });
transactionSchema.index({ type: 1, provider: 1, status: 1, createdAt: -1 });

export const Transaction = mongoose.model("Transaction", transactionSchema);
