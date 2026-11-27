const { redeemGiftKey } = require("../lib/gift-keys");
const { createDownloadCookie } = require("../lib/release-access");

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
        used: "This gift code has already been redeemed.",
        revoked: "This gift code has been revoked.",
        available: "This gift code could not be redeemed."
      };

      return res.status(409).json({
        success: false,
        error: messages[result.reason] ||
          "This gift code cannot be redeemed."
      });
    }

    res.setHeader(
      "Set-Cookie",
      createDownloadCookie(result.downloadId)
    );

    return res.status(200).json({
      success: true,
      message: "You've redeemed a code!",
      downloadAuthorized: true
    });

  } catch (error) {
    console.error("Gift Code Redemption Error:", error);

    return res.status(500).json({
      success: false,
      error: "Something went wrong. Please try again later."
    });
  }
};
