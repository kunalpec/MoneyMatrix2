import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["TATUM", "TRANSAK"],
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      default: null,
      index: true,
    },
    eventId: {
      type: String,
      default: null,
      index: true,
    },
    txId: {
      type: String,
      default: null,
      index: true,
    },
    externalId: {
      type: String,
      default: null,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    processingStatus: {
      type: String,
      enum: ["RECEIVED", "PROCESSING", "SUCCESS", "FAILED", "IGNORED"],
      default: "RECEIVED",
      index: true,
    },
    startedAt: Date,
    processedAt: Date,
    finishedAt: Date,
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

webhookEventSchema.index(
  { provider: 1, eventId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      eventId: { $exists: true, $type: "string" },
    },
  }
);

export const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);
