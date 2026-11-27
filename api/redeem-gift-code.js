
const { redeemGiftKey } = require("../lib/gift-keys");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const code = String(req.body?.code || "").trim();

    if (!code || code.length > 32) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid gift code."
      });
    }

    const result = await redeemGiftKey(code);

    if (!result.success) {
      const messages = {
        invalid: "This gift code is invalid.",
        expired: "This gift code has expired.",
        used: "This gift code has already been used.",
        revoked: "This gift code has been revoked.",
        available: "This gift code could not be redeemed."
      };

      return res.status(409).json({
        success: false,
        error: messages[result.reason] || "This gift code cannot be used."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Gift code redeemed successfully.",
      downloadAuthorized: true
    });

  } catch (error) {
    console.error("Gift code redemption error:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to verify your gift code right now. Please try again."
    });
  }
};
