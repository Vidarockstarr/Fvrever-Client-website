
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
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function safeGalleryPath(value) {
  if (typeof value !== "string") return null;

  const pathname = value.trim();

  if (
    !pathname.startsWith("gallery/") ||
    pathname.includes("..") ||
    pathname.includes("\\") ||
    pathname.startsWith("/") ||
    pathname.length > 500
  ) {
    return null;
  }

  return pathname;
}

function galleryPaths(gallery) {
  if (!Array.isArray(gallery)) return [];

  return gallery
    .map(item => safeGalleryPath(item?.pathname))
    .filter(Boolean);
}

async function readCurrentContent(list) {
  const { blobs } = await list({
    prefix: "site-content.json",
    limit: 1
  });

  if (!blobs?.length) return DEFAULT_CONTENT;

  const response = await fetch(blobs[0].url);

  if (!response.ok) {
    throw new Error("Could not read existing website content");
  }

  return {
    ...DEFAULT_CONTENT,
    ...(await response.json())
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const { list, put, del } = await import("@vercel/blob");

    // Public: retrieve website content
    if (req.method === "GET") {
      const content = await readCurrentContent(list);
      return send(res, 200, content);
    }

    // Private: only the administrator can save content
    if (req.method === "PUT") {
      const session = readSession(req);

      if (!session || session.sub !== "fvrever") {
        return send(res, 401, { error: "Unauthorized" });
      }

      const submitted = parseBody(req.body);

      if (
        !submitted ||
        typeof submitted !== "object" ||
        Array.isArray(submitted)
      ) {
        return send(res, 400, { error: "Invalid content" });
      }

      const previous = await readCurrentContent(list);

      const content = {
        ...DEFAULT_CONTENT,
        ...submitted,
        lastUpdated: new Date().toISOString()
      };

      if (!Array.isArray(content.gallery)) {
        return send(res, 400, { error: "Invalid gallery" });
      }

      const json = JSON.stringify(content);

      if (Buffer.byteLength(json, "utf8") > 1024 * 1024) {
        return send(res, 413, { error: "Content is too large" });
      }

      // Save the new content first.
      await put("site-content.json", json, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60
      });

      // Find old gallery images that are no longer referenced.
      const oldPaths = new Set(galleryPaths(previous.gallery));
      const newPaths = new Set(galleryPaths(content.gallery));

      const pathsToDelete = [...oldPaths].filter(
        pathname => !newPaths.has(pathname)
      );

      // Never delete an image still referenced by another slot.
      const cleanupResults = await Promise.allSettled(
        pathsToDelete.map(pathname => del(pathname))
      );

      const cleanupFailures = cleanupResults
        .map((result, index) => ({
          result,
          pathname: pathsToDelete[index]
        }))
        .filter(item => item.result.status === "rejected")
        .map(item => item.pathname);

      return send(res, 200, {
        success: true,
        lastUpdated: content.lastUpdated,
        deletedGalleryFiles: pathsToDelete.length - cleanupFailures.length,
        cleanupWarnings: cleanupFailures
      });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Content API error:", error);

    return send(res, 500, {
      error: error.message || "Internal server error"
    });
  }
};
