
const { readSession } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    const session = readSession(req);

    if (!session) {
      return res.status(401).json({
        authenticated: false
      });
    }

    return res.status(200).json({
      authenticated: true,
      username: session.sub,
      expiresAt: session.exp
    });

  } catch (error) {
    console.error("Session check error:", error.message);

    return res.status(500).json({
      authenticated: false,
      error: "Internal server error."
    });
  }
};
