const formatLog = (level, message, meta = {}) => ({
  level,
  message,
  timestamp: new Date().toISOString(),
  ...meta,
});

const writeLog = (level, message, meta = {}) => {
  const entry = formatLog(level, message, meta);
  const serialized = JSON.stringify(entry);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
};

export const logger = {
  info: (message, meta = {}) => writeLog("info", message, meta),
  warn: (message, meta = {}) => writeLog("warn", message, meta),
  error: (message, meta = {}) => writeLog("error", message, meta),
};
