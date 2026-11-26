
const { readSession } = require("../lib/auth");

const DEFAULT_CONTENT = {
  siteTitle: "FVREVER CLIENT",
  heroTitle: "ENTER THE FVREVER CLIENT",
  heroDescription: "Your next Minecraft PvP experience starts here.",
  version: "1.0.0",
  downloadUrl: "",
  downloadName: "FVREVER Client",
  discordUrl: "",
  features: [],
  gallery: [],
  changelog: [],
  lastUpdated: null
};

function send(res, status, data) {
  return res.status(status).json(data);
}

function parseBody(body) {
  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return body;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const { list, put } = await import("@vercel/blob");

    // PUBLIC: read website configuration
    if (req.method === "GET") {
      const { blobs } = await list({
        prefix: "site-content.json",
        limit: 1
      });

      if (!blobs || blobs.length === 0) {
        return send(res, 200, DEFAULT_CONTENT);
      }

      const response = await fetch(blobs[0].url);

      if (!response.ok) {
        throw new Error("Could not read website content");
      }

      const content = await response.json();

      return send(res, 200, content);
    }

    // PRIVATE: only authenticated administrator can save
    if (req.method === "PUT") {
      const session = readSession(req);

      if (!session) {
        return send(res, 401, {
          error: "Unauthorized"
        });
      }

      const content = parseBody(req.body);

      if (
        !content ||
        typeof content !== "object" ||
        Array.isArray(content)
      ) {
        return send(res, 400, {
          error: "Invalid content"
        });
      }

      const json = JSON.stringify({
        ...DEFAULT_CONTENT,
        ...content,
        lastUpdated: new Date().toISOString()
      });

      if (Buffer.byteLength(json, "utf8") > 1024 * 1024) {
        return send(res, 413, {
          error: "Content is too large"
        });
      }

      const blob = await put(
        "site-content.json",
        json,
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
          cacheControlMaxAge: 60
        }
      );

      return send(res, 200, {
        success: true,
        lastUpdated: new Date().toISOString()
      });
    }

    return send(res, 405, {
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("Content API error:", error);

    return send(res, 500, {
      error: "Internal server error"
    });
  }
};

