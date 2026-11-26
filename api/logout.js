
const { clearSessionCookie } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", clearSessionCookie());

  return res.status(200).json({
    success: true,
    message: "Session closed."
  });
};
