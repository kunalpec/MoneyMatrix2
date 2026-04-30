import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, "../../logs");

// Production: JSON format for log aggregation
// Development: Readable format
const isProduction = process.env.NODE_ENV === "production";

const format = isProduction
  ? winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    )
  : winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.colorize(),
      winston.format.printf(
        ({ timestamp, level, message, ...metadata }) => {
          let meta = "";
          if (Object.keys(metadata).length > 0) {
            meta = JSON.stringify(metadata, null, 2);
          }
          return `${timestamp} [${level}]: ${message} ${meta}`;
        }
      )
    );

const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  }),
];

if (isProduction) {
  // Error logs (daily rotation)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxDays: "30",
      level: "error",
      format: format,
    })
  );

  // Combined logs (daily rotation)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxDays: "30",
      format: format,
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "exceptions.log"),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "rejections.log"),
    }),
  ],
});

// HTTP Request Logger Middleware
export const httpLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    };

    if (res.statusCode >= 400) {
      logger.warn("HTTP Request", logData);
    } else if (res.statusCode >= 200 && res.statusCode < 400) {
      logger.debug("HTTP Request", logData);
    }
  });

  next();
};

export default logger;
