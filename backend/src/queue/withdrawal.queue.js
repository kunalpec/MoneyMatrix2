import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./redis.connection.js";
import { logger } from "../util/logger.util.js";
import { processQueuedWithdrawal } from "../service/payment/withdrawal.service.js";

export const WITHDRAWAL_QUEUE_NAME = "trx-withdrawals";

let withdrawalQueue = null;
let withdrawalWorker = null;

export const getWithdrawalQueue = () => {
  if (!withdrawalQueue) {
    withdrawalQueue = new Queue(WITHDRAWAL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: Number(process.env.WITHDRAWAL_JOB_ATTEMPTS || 5),
        backoff: {
          type: "exponential",
          delay: Number(process.env.WITHDRAWAL_JOB_BACKOFF_MS || 5000),
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  return withdrawalQueue;
};

export const enqueueWithdrawalJob = async (transactionId) => {
  const queue = getWithdrawalQueue();

  const job = await queue.add(
    "process-withdrawal",
    { transactionId },
    {
      jobId: `withdrawal_${transactionId}`,
    }
  );

  logger.info("withdrawal.enqueued", {
    transactionId,
    jobId: job.id,
  });

  return job;
};

export const startWithdrawalWorker = () => {
  if (withdrawalWorker) {
    return withdrawalWorker;
  }

  withdrawalWorker = new Worker(
    WITHDRAWAL_QUEUE_NAME,
    async (job) => processQueuedWithdrawal(job.data),
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.WITHDRAWAL_WORKER_CONCURRENCY || 2),
    }
  );

  withdrawalWorker.on("completed", (job) => {
    logger.info("withdrawal.job.completed", {
      jobId: job.id,
      transactionId: job.data?.transactionId,
    });
  });

  withdrawalWorker.on("failed", (job, error) => {
    logger.error("withdrawal.job.failed", {
      jobId: job?.id,
      transactionId: job?.data?.transactionId,
      error: error?.message,
    });
  });

  return withdrawalWorker;
};
