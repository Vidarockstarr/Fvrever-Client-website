
const crypto = require("crypto");

const COOKIE_NAME = "fvrever_session";
const SESSION_DURATION = 12 * 60 * 60;

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 64) {
    throw new Error("SESSION_SECRET is missing or too short.");
  }

  return secret;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

function createSession(username) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION
  })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function readSession(req) {
  try {
    const cookies = (req.headers.cookie || "").split(";");

    const sessionCookie = cookies
      .map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith(COOKIE_NAME + "="));

    if (!sessionCookie) return null;

    const token = decodeURIComponent(
      sessionCookie.substring(COOKIE_NAME.length + 1)
    );

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;
    const expectedSignature = sign(payload);

    const received = Buffer.from(signature);
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
      data.sub !== "fvrever" ||
      !Number.isInteger(data.exp) ||
      data.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function sessionCookie(token, maxAge = SESSION_DURATION) {
  const secure =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  const secure =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

module.exports = {
  createSession,
  readSession,
  sessionCookie,
  clearSessionCookie
};
