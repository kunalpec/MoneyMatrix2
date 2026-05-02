import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./redis.connection.js";
import { logger } from "../util/logger.util.js";
import { runWithdrawalReconciliationBatch } from "../service/payment/reconciliation.service.js";

export const WITHDRAWAL_RECONCILIATION_QUEUE_NAME =
  "trx-withdrawal-reconciliation";

let reconciliationQueue = null;
let reconciliationWorker = null;

export const getWithdrawalReconciliationQueue = () => {
  if (!reconciliationQueue) {
    reconciliationQueue = new Queue(WITHDRAWAL_RECONCILIATION_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: Number(process.env.RECONCILIATION_JOB_ATTEMPTS || 3),
        backoff: {
          type: "exponential",
          delay: Number(process.env.RECONCILIATION_JOB_BACKOFF_MS || 10000),
        },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    });
  }

  return reconciliationQueue;
};

export const scheduleWithdrawalReconciliationJob = async () => {
  const queue = getWithdrawalReconciliationQueue();
  const everyMs = Number(
    process.env.WITHDRAWAL_RECONCILIATION_INTERVAL_MS || 300000
  );

  await queue.upsertJobScheduler(
    "withdrawal-reconciliation-scheduler",
    {
      every: everyMs,
    },
    {
      name: "reconcile-withdrawals",
      data: {},
    }
  );

  logger.info("withdrawal.reconciliation.scheduler_started", {
    everyMs,
  });

  return queue;
};

export const startWithdrawalReconciliationWorker = () => {
  if (reconciliationWorker) {
    return reconciliationWorker;
  }

  reconciliationWorker = new Worker(
    WITHDRAWAL_RECONCILIATION_QUEUE_NAME,
    async () => runWithdrawalReconciliationBatch(),
    {
      connection: getRedisConnection(),
      concurrency: Number(
        process.env.WITHDRAWAL_RECONCILIATION_WORKER_CONCURRENCY || 1
      ),
    }
  );

  reconciliationWorker.on("completed", (job, result) => {
    logger.info("withdrawal.reconciliation.job.completed", {
      jobId: job.id,
      workerId: result?.workerId || null,
      processedCount: result?.processedCount || 0,
    });
  });

  reconciliationWorker.on("failed", (job, error) => {
    logger.error("withdrawal.reconciliation.job.failed", {
      jobId: job?.id,
      error: error?.message || "Unknown reconciliation worker error",
    });
  });

  return reconciliationWorker;
};
