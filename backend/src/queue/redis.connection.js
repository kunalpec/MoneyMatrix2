import IORedis from "ioredis";

let redisConnection = null;

const commonRedisOptions = {
  maxRetriesPerRequest: null,
};

const buildRedisConfig = () => {
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      options: commonRedisOptions,
    };
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    ...commonRedisOptions,
  };
};

export const getRedisConnection = () => {
  if (!redisConnection) {
    const config = buildRedisConfig();

    redisConnection = config.url
      ? new IORedis(config.url, config.options)
      : new IORedis(config);
  }

  return redisConnection;
};
