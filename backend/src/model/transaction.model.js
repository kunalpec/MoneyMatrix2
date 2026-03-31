// models/transaction.model.js

import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: ["DEPOSIT", "WITHDRAW", "SWEEP"],
    },
    amount: Number,
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
    txId: String,
    fromAddress: String,
    toAddress: String,
    externalId: String,
    confirmedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

export const Transaction = mongoose.model(
  "Transaction",
  transactionSchema
);