import { body, query, param, validationResult } from "express-validator";
import { logger } from "../util/logger.js";

// Validation error handler middleware
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn("Validation error", {
      path: req.path,
      errors: errors.array(),
    });
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
      })),
      statusCode: 400,
    });
  }
  next();
};

// Common validators
export const emailValidator = body("email")
  .isEmail()
  .normalizeEmail()
  .withMessage("Invalid email address");

export const passwordValidator = body("password")
  .isLength({ min: 8 })
  .withMessage("Password must be at least 8 characters long")
  .matches(/[A-Z]/)
  .withMessage("Password must contain uppercase letter")
  .matches(/[0-9]/)
  .withMessage("Password must contain number");

export const phoneValidator = body("phone")
  .matches(/^[0-9+\-\s()]{10,}$/)
  .withMessage("Invalid phone number");

export const mongoIdValidator = param("id")
  .matches(/^[0-9a-fA-F]{24}$/)
  .withMessage("Invalid MongoDB ID");

export const amountValidator = body("amount")
  .isFloat({ min: 0.01 })
  .withMessage("Amount must be a positive number");

export const transactionValidator = [
  amountValidator,
  body("transactionType")
    .isIn(["deposit", "withdrawal", "transfer", "bet", "payout"])
    .withMessage("Invalid transaction type"),
  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Description too long"),
];

export default {
  handleValidationErrors,
  emailValidator,
  passwordValidator,
  phoneValidator,
  mongoIdValidator,
  amountValidator,
  transactionValidator,
};
