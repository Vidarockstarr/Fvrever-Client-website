
const {
  readSession
} = require("../lib/auth");

const {
  createGiftKeys,
  listGiftKeys,
  getGiftKeyStats,
  revokeGiftKey
} = require("../lib/gift-keys");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Verify administrator session
  try {
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  try {
    // GET: list keys and statistics
    if (req.method === "GET") {
      const action = String(req.query.action || "list");

      if (action === "stats") {
        const stats = await getGiftKeyStats();

        return res.status(200).json({
          success: true,
          stats
        });
      }

      if (action === "list") {
        const status = String(req.query.status || "all");
        const search = String(req.query.search || "");
        const limit = Number(req.query.limit || 100);
        const offset = Number(req.query.offset || 0);

        const allowedStatuses = [
          "all",
          "available",
          "used",
          "expired",
          "revoked"
        ];

        if (!allowedStatuses.includes(status)) {
          return res.status(400).json({
            success: false,
            error: "Invalid status"
          });
        }

        const keys = await listGiftKeys({
          status,
          search,
          limit,
          offset
        });

        return res.status(200).json({
          success: true,
          keys
        });
      }

      return res.status(400).json({
        success: false,
        error: "Unknown action"
      });
    }

    // POST: generate or revoke keys
    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "");

      if (action === "generate") {
        const quantity = Number(body.quantity || 1);

        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 500
        ) {
          return res.status(400).json({
            success: false,
            error: "Quantity must be between 1 and 500"
          });
        }

        const keys = await createGiftKeys(quantity);

        return res.status(201).json({
          success: true,
          count: keys.length,
          keys
        });
      }

      if (action === "revoke") {
        const id = Number(body.id);

        if (!Number.isSafeInteger(id) || id < 1) {
          return res.status(400).json({
            success: false,
            error: "Invalid key ID"
          });
        }

        const result = await revokeGiftKey(id);

        if (!result) {
          return res.status(409).json({
            success: false,
            error: "Code cannot be revoked. It may already be used, expired, or revoked."
          });
        }

        return res.status(200).json({
          success: true,
          revoked: result
        });
      }

      return res.status(400).json({
        success: false,
        error: "Unknown action"
      });
    }

    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("Gift Keys API error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};
