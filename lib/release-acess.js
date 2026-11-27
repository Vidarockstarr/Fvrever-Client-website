const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const COOKIE_NAME = "fvrever_download";
const TOKEN_DURATION = 24 * 60 * 60;

function getConfig() {
  const secret = process.env.GIFT_KEY_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("GIFT_KEY_SECRET is missing or invalid");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing");
  }

  return {
    key: Buffer.from(secret, "hex"),
    sql: neon(databaseUrl)
  };
}

function sign(payload, key) {
  return crypto
    .createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
}

function createDownloadToken(downloadId) {
  const { key } = getConfig();

  const id = String(downloadId);

  if (!/^\d{1,20}$/.test(id)) {
    throw new Error("Invalid download ID");
  }

  const payload = Buffer.from(JSON.stringify({
    id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_DURATION
  })).toString("base64url");

  return `${payload}.${sign(payload, key)}`;
}

function createDownloadCookie(downloadId) {
  const token = createDownloadToken(downloadId);

  const secure =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${TOKEN_DURATION}`
  ].join("; ") + secure;
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");

  const cookie = cookies
    .map(item => item.trim())
    .find(item => item.startsWith(`${name}=`));

  if (!cookie) return null;

  return cookie.slice(name.length + 1);
}

function verifyDownloadToken(token) {
  try {
    if (!token || typeof token !== "string") {
      return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const { key } = getConfig();
    const [payload, receivedSignature] = parts;

    const expectedSignature = sign(payload, key);

    const received = Buffer.from(receivedSignature);
    const expected = Buffer.from(expectedSignature);

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !data ||
      typeof data.id !== "string" ||
      !/^\d{1,20}$/.test(data.id) ||
      !Number.isInteger(data.exp) ||
      data.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return data.id;
  } catch {
    return null;
  }
}

async function hasAuthorizedDownload(downloadId) {
  if (!/^\d{1,20}$/.test(String(downloadId || ""))) {
    return false;
  }

  const { sql } = getConfig();

  const rows = await sql`
    SELECT id
    FROM public.gift_key_downloads
    WHERE id = ${String(downloadId)}
      AND status = 'authorized'
    LIMIT 1
  `;

  return rows.length > 0;
}

async function consumeAuthorizedDownload(downloadId) {
  if (!/^\d{1,20}$/.test(String(downloadId || ""))) {
    return false;
  }

  const { sql } = getConfig();

  const rows = await sql`
    UPDATE public.gift_key_downloads
    SET
      status = 'completed',
      completed_at = NOW()
    WHERE
      id = ${String(downloadId)}
      AND status = 'authorized'
    RETURNING id
  `;

  return rows.length > 0;
}

module.exports = {
  createDownloadCookie,
  getCookie,
  verifyDownloadToken,
  hasAuthorizedDownload,
  consumeAuthorizedDownload
};
