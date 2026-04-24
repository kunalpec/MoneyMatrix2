import IORedis from "ioredis";

let redisConnection = null;

const buildRedisConfig = () => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
};

export const getRedisConnection = () => {
  if (!redisConnection) {
    redisConnection = new IORedis(buildRedisConfig());
  }

  return redisConnection;
};
