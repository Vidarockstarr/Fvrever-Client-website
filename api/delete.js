
const { readSession } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const session = readSession(req);

    if (!session) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { url } = req.body || {};

    if (typeof url !== "string") {
      return res.status(400).json({
        error: "Invalid URL"
      });
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({
        error: "Invalid URL"
      });
    }

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".blob.vercel-storage.com")
    ) {
      return res.status(400).json({
        error: "Invalid storage URL"
      });
    }

    const pathname = decodeURIComponent(parsed.pathname);

    if (
      !pathname.startsWith("/gallery/") &&
      !pathname.startsWith("/releases/")
    ) {
      return res.status(400).json({
        error: "This file cannot be deleted"
      });
    }

    const { del } = await import("@vercel/blob");

    await del(url);

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error("Delete error:", error);

    return res.status(500).json({
      error: "Could not delete file"
    });
  }
};
