import crypto from "crypto";

export const rawBodyParser = (req, res, next) => {
  if (req.method !== "POST") return next();

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
  const rawBodyBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.rawBody === "string"
      ? Buffer.from(req.rawBody, "utf8")
      : null;

  if (!hashHeader || !secret || !rawBodyBuffer) {
    console.log(
      "Missing: header=",
      !!hashHeader,
      "secret=",
      !!secret,
      "rawBody=",
      !!rawBodyBuffer
    );
    return false;
  }

  const expectedHash = crypto
    .createHmac("sha512", secret)
    .update(rawBodyBuffer)
    .digest("base64");

  const providedHash = String(
    Array.isArray(hashHeader) ? hashHeader[0] : hashHeader
  ).trim();

  console.log("Expected:", expectedHash);
  console.log("Provided:", providedHash);
  console.log("Match:", expectedHash === providedHash);

  return expectedHash === providedHash;
};

export const parseBufferedJsonBody = (req) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString("utf8");

    try {
      req.body = req.rawBody.trim() ? JSON.parse(req.rawBody) : {};
    } catch {
      req.body = {};
    }

    return req.body;
  }

  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (req.rawBody) {
    try {
      req.body = JSON.parse(req.rawBody);
    } catch {
      req.body = {};
    }
  }

  return req.body;
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
