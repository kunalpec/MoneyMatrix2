import mongoose from "mongoose";
import { Transaction } from "../model/transaction.model.js";
import { Wallet } from "../model/wallet.model.js";
import { buildWithdrawalRollbackIncrementFromSun } from "../service/payment/withdrawal.service.js";
import { getReservedWithdrawalAmountSun } from "../service/payment/withdrawal.service.js";
import { logger } from "../util/logger.util.js";

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export const reconcileStuckWithdrawals = async () => {
  const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckTransactions = await Transaction.find({
    type: "WITHDRAW",
    status: { $in: ["LOCKED", "PROCESSING"] },
    lockedAt: { $lt: stuckThreshold },
    processed: false,
  });

  for (const tx of stuckTransactions) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Rollback locked funds to user balance
        if (tx.metadata?.reservedFromUserBalance && tx.userId) {
          const wallet = await Wallet.findOne({ user: tx.userId }).session(session);
          if (wallet && wallet.trxLockedBalanceSun >= getReservedWithdrawalAmountSun(tx)) {
            await Wallet.updateOne(
              { _id: wallet._id },
              { $inc: buildWithdrawalRollbackIncrementFromSun(getReservedWithdrawalAmountSun(tx)) },
              { session }
            );
          }
        }

        // Mark transaction as failed
        await Transaction.updateOne(
          { _id: tx._id },
          {
            $set: {
              status: "FAILED",
              processed: true,
              processedAt: new Date(),
              lastError: "Reconciled as stuck transaction",
            },
          },
          { session }
        );

        logger.warn("withdrawal.reconciled", { transactionId: tx._id.toString() });
      });
    } catch (error) {
      logger.error("reconciliation.failed", { transactionId: tx._id.toString(), error: error.message });
    } finally {
      await session.endSession();
    }
  }

  logger.info("reconciliation.completed", { reconciledCount: stuckTransactions.length });
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await reconcileStuckWithdrawals();
  process.exit(0);
}