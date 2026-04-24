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

    status: {
      type: String,
      enum: ["PENDING", "LOCKED", "PROCESSING", "SUCCESS", "FAILED"],
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
      enum: ["TRX", null],
      default: "TRX",
    },

    // 🔗 Blockchain / external references
    txId: {
      type: String,
      trim: true,
    },

    externalId: {
      type: String, // partnerOrderId (Transak)
      trim: true,
    },

    providerOrderId: {
      type: String, // Transak orderId/order_id
      trim: true,
      index: true,
    },

    // 💸 Addresses
    fromAddress: String,
    toAddress: String,

    // 🧠 Store raw webhook / provider data
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },

    // 🔁 retry / idempotency
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

    lastError: String,
    lockedAt: Date,
    processedAt: Date,

    // ⏱ timestamps
    confirmedAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

// 🔐 Prevent duplicate externalId (important for Transak)
transactionSchema.index(
  { externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalId: { $exists: true, $type: "string" },
    },
  }
);

// 🔐 Prevent duplicate txId (blockchain safety)
transactionSchema.index(
  { txId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      txId: { $exists: true, $type: "string" },
    },
  }
);

export const Transaction = mongoose.model("Transaction", transactionSchema);
