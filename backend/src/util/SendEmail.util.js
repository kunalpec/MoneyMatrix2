import nodemailer from "nodemailer";
import { ApiError } from "./ApiError.util.js";
import dotenv from "dotenv";
dotenv.config();

const emailUser = String(process.env.EMAIL_USER || "").trim();
const emailPass = String(process.env.EMAIL_PASS || "")
  .trim()
  .replace(/\s+/g, "");
const emailHost = String(process.env.EMAIL_HOST || "smtp.gmail.com").trim();
const emailPort = Number(process.env.EMAIL_PORT || 587);
const emailSecure = String(process.env.EMAIL_SECURE || "false").trim().toLowerCase() === "true";
const allowInvalidTls =
  String(process.env.EMAIL_ALLOW_INVALID_TLS || "false").trim().toLowerCase() === "true";

const transporter = nodemailer.createTransport({
  host: emailHost,
  port: emailPort,
  secure: emailSecure,
  requireTLS: !emailSecure,
  auth: {
    user: emailUser,
    pass: emailPass
  },
  tls: {
    servername: emailHost,
    rejectUnauthorized: !allowInvalidTls
  }
});

export const SendCustomEmail = async ({ to, subject, text }) => {
  if (!emailUser || !emailPass) {
    throw new Error("Email is not configured. Set EMAIL_USER and EMAIL_PASS in backend/.env");
  }

  const mailOptions = {
    from: `MoneyMatrix <${emailUser}>`,
    to,
    subject,
    text
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    const smtpMessage =
      error?.response ||
      error?.message ||
      "Unknown email delivery error";

    console.error("Error sending email:", smtpMessage);
    throw new ApiError(500, "Error sending email");
  }
};
