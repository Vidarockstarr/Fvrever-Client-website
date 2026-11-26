
const crypto = require("crypto");

const {
  createSession,
  sessionCookie
} = require("../lib/auth");

function safeCompare(a, b) {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const username = process.env.DASHBOARD_USERNAME || "fvrever";
    const password = process.env.DASHBOARD_PASSWORD;

    if (!password) {
      return res.status(500).json({
        success: false,
        error: "Dashboard authentication is not configured."
      });
    }

    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        success: false,
        error: "Invalid request."
      });
    }

    const submittedUsername =
      typeof body.username === "string" ? body.username : "";

    const submittedPassword =
      typeof body.password === "string" ? body.password : "";

    if (
      submittedUsername.length > 100 ||
      submittedPassword.length > 1024
    ) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password."
      });
    }

    const validUsername = safeCompare(
      submittedUsername,
      username
    );

    const validPassword = safeCompare(
      submittedPassword,
      password
    );

    if (!validUsername || !validPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password."
      });
    }

    const token = createSession(username);

    res.setHeader("Set-Cookie", sessionCookie(token));

    return res.status(200).json({
      success: true,
      message: "Login successful."
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
};
