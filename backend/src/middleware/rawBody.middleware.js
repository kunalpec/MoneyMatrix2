import crypto from "crypto";

export const rawBodyParser = (req, res, next) => {
  if (req.method !== "POST" || typeof req.rawBody === "string") {
    return next();
  }

  let data = "";
  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    data += chunk;
  });

  req.on("end", () => {
    req.rawBody = data;

    try {
      req.body = data.trim() ? JSON.parse(data) : {};
    } catch {
      req.body = {};
    }

    next();
  });
};

export const verifyTatumHMAC = (req, secret) => {
  const hashHeader = req.headers["x-payload-hash"];

  if (!hashHeader || !secret || typeof req.rawBody !== "string") {
    return false;
  }

  const expected = crypto
    .createHmac("sha512", secret)
    .update(req.rawBody, "utf8")
    .digest("base64");

  return String(hashHeader).trim() === expected;
};

export const verifySha256HmacSignature = ({
  payload,
  providedSignature,
  secret,
  prefix = "sha256=",
}) => {
  if (!payload || !providedSignature || !secret) {
    return false;
  }

  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const normalizedProvided = String(providedSignature)
    .trim()
    .replace(new RegExp(`^${prefix}`, "i"), "")
    .toLowerCase();

  const expectedBuffer = Buffer.from(expectedHash, "utf8");
  const providedBuffer = Buffer.from(normalizedProvided, "utf8");

  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
};
