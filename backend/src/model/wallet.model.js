import mongoose from "mongoose";

const SUN_PER_TRX = 1_000_000;

const toSun = (trx) => Math.round(Number(trx) * SUN_PER_TRX);
const fromSun = (sun) => Number(sun) / SUN_PER_TRX;

const assertPositiveSunAmount = (amount, label) => {
  const sun = toSun(amount);

  if (!Number.isSafeInteger(sun) || sun <= 0) {
    throw new Error(`Invalid ${label}`);
  }

  return sun;
};

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    trxBalanceSun: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "trxBalanceSun must be an integer",
      },
    },
    trxLockedBalanceSun: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "trxLockedBalanceSun must be an integer",
      },
    },
    address: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    depositSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    xpub: {
      type: String,
      required: true,
      unique: true,
    },
    mnemonic: {
      type: String,
      default: null,
    },
    index: {
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
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

walletSchema.virtual("trxBalance").get(function () {
  return fromSun(this.trxBalanceSun || 0);
});

walletSchema.virtual("trxLockedBalance").get(function () {
  return fromSun(this.trxLockedBalanceSun || 0);
});

walletSchema.methods.credit = function (amount) {
  const amountSun = assertPositiveSunAmount(amount, "credit amount");
  this.trxBalanceSun += amountSun;
  return this;
};

walletSchema.methods.debit = function (amount) {
  const amountSun = assertPositiveSunAmount(amount, "debit amount");

  if (this.trxBalanceSun < amountSun) {
    throw new Error("Insufficient balance");
  }

  this.trxBalanceSun -= amountSun;
  return this;
};

walletSchema.methods.lock = function (amount) {
  const amountSun = assertPositiveSunAmount(amount, "bet amount");

  if (this.trxBalanceSun < amountSun) {
    throw new Error("Insufficient balance");
  }

  this.trxBalanceSun -= amountSun;
  this.trxLockedBalanceSun += amountSun;
  return this;
};

walletSchema.methods.settleWin = function (betAmount, winAmount) {
  const betAmountSun = assertPositiveSunAmount(
    betAmount,
    "bet settlement amount"
  );
  const winAmountSun = toSun(winAmount);

  if (!Number.isSafeInteger(winAmountSun) || winAmountSun < 0) {
    throw new Error("Invalid win amount");
  }

  if (this.trxLockedBalanceSun < betAmountSun) {
    throw new Error("Locked balance is insufficient for settlement");
  }

  this.trxLockedBalanceSun -= betAmountSun;
  this.trxBalanceSun += winAmountSun;
  return this;
};

walletSchema.methods.settleLoss = function (amount) {
  const amountSun = assertPositiveSunAmount(
    amount,
    "loss settlement amount"
  );

  if (this.trxLockedBalanceSun < amountSun) {
    throw new Error("Locked balance is insufficient for settlement");
  }

  this.trxLockedBalanceSun -= amountSun;
  return this;
};

export const Wallet = mongoose.model("Wallet", walletSchema);
